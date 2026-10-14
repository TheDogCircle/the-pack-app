// Phase Pro 4 : resolution de prix et regles de reservation, partagees entre
// create-payment-intent, create-cart-reservations et purchase-forfait --
// jamais dupliquees trois fois (meme convention que _shared/pushTracking.ts).
// Phase Pro 5 : ajoute conges/temps tampon (congés, buffer) et bascule la
// commission sur resolveCommissionPercent (organizations.commission_rate,
// source d'autorite depuis le socle commun -- cf _shared/commission.ts).

import { resolveCommissionPercent } from './commission.ts'

export type ResolvedOffer = {
  offer: any
  offerPrice: any
  prixCents: number
  dureeMinutes: number
  legacyPrestationId: string | null
  legacyForfaitId: string | null
  options: any[]
}

// Resout la variante de prix d'une offre -- gabarit/type_poil pour
// 'gabarit_poil', duree_minutes pour 'duree', sinon la seule ligne
// offer_prices existante (prix_fixe/place/abonnement/forfait).
export async function resolveOfferPrice(
  supabaseAdmin: any,
  offerId: string,
  lieuId: string,
  opts: { gabarit?: string; typePoil?: string; dureeMinutes?: number },
): Promise<ResolvedOffer> {
  const { data: offer, error: offerErr } = await supabaseAdmin
    .from('offers').select('*, offer_prices(*), offer_options(*)').eq('id', offerId).maybeSingle()
  if (offerErr) throw offerErr
  if (!offer || offer.lieu_id !== lieuId) throw new Error('Offre introuvable')
  if (offer.statut !== 'en_ligne' || !offer.reservable_en_ligne) throw new Error("Cette offre n'est plus disponible à la réservation")

  let offerPrice: any
  if (offer.type === 'gabarit_poil') {
    offerPrice = (offer.offer_prices || []).find((p: any) => p.gabarit === opts.gabarit && p.type_poil === opts.typePoil)
    if (!offerPrice) throw new Error('Gabarit/type de poil introuvable pour cette offre')
  } else if (offer.type === 'duree') {
    offerPrice = (offer.offer_prices || []).find((p: any) => p.duree_minutes === opts.dureeMinutes)
    if (!offerPrice) throw new Error('Durée introuvable pour cette offre')
  } else {
    offerPrice = (offer.offer_prices || [])[0]
  }
  if (!offerPrice || !offerPrice.prix_cents) throw new Error('Tarif introuvable pour cette offre')

  return {
    offer,
    offerPrice,
    prixCents: offerPrice.prix_cents,
    dureeMinutes: offerPrice.duree_minutes || 60,
    legacyPrestationId: offer.legacy_prestation_id,
    legacyForfaitId: offer.legacy_forfait_id,
    options: offer.offer_options || [],
  }
}

// Remise membres Meute fondatrice -- profils.ambassadeur est le seul
// marqueur de statut "membre fondateur" deja present dans le schema.
export function applyRemiseMembre(prixCents: number, options: any[], isAmbassadeur: boolean): number {
  if (!isAmbassadeur) return prixCents
  const remise = options.find((o) => o.type === 'remise_membre' && o.pourcentage)
  if (!remise) return prixCents
  return Math.max(0, Math.round(prixCents * (1 - remise.pourcentage / 100)))
}

export type BookingRules = {
  delai_min_heures: number
  acompte_pourcentage: number
  acompte_seuil_cents: number | null
  annulation_gratuite_heures: number
  confirmation_auto: boolean
  buffer_minutes: number
}

const DEFAULT_RULES: BookingRules = {
  delai_min_heures: 0, acompte_pourcentage: 0, acompte_seuil_cents: null,
  annulation_gratuite_heures: 24, confirmation_auto: false, buffer_minutes: 0,
}

export async function getBookingRules(supabaseAdmin: any, orgId: string | null): Promise<BookingRules> {
  if (!orgId) return DEFAULT_RULES
  const { data } = await supabaseAdmin.from('org_booking_rules').select('*').eq('org_id', orgId).maybeSingle()
  return data || DEFAULT_RULES
}

// Verifie le delai minimum avant reservation (ex. "pas de reservation a
// moins de 2h du creneau"). Leve une erreur si trop tard, ne retourne rien.
export function checkDelaiMin(date: string, heureDebut: string, rules: BookingRules) {
  if (!rules.delai_min_heures) return
  // 'Z' explicite -- meme convention que le reste de ce fichier (cf. le calcul
  // du jour de la semaine dans create-payment-intent) : sans lui, Deno
  // interprete la chaine comme heure serveur (UTC), decalee de 1-2h par
  // rapport a l'heure francaise reellement voulue par date/heure_debut.
  const slot = new Date(`${date}T${heureDebut}Z`)
  const minAllowed = new Date(Date.now() + rules.delai_min_heures * 3_600_000)
  if (slot < minAllowed) throw new Error(`Ce créneau nécessite au moins ${rules.delai_min_heures}h de délai avant la réservation`)
}

// Rejette une reservation sur une date couverte par un conge (fermeture
// exceptionnelle du lieu) -- verifie en app, meme esprit que checkDelaiMin
// (regle metier, pas une invariante d'integrite -- celle-ci reste la
// contrainte d'exclusion Postgres sur reservations.periode).
export async function checkConges(supabaseAdmin: any, lieuId: string, date: string) {
  const { data } = await supabaseAdmin
    .from('conges').select('id').eq('lieu_id', lieuId).lte('date_debut', date).gte('date_fin', date).maybeSingle()
  if (data) throw new Error('Ce lieu est fermé à cette date')
}

// Rejette une reservation trop proche (avant ou apres) d'une reservation
// active existante du meme lieu, selon le temps tampon configure par
// l'organisation. Meme logique de "heure locale implicite" que checkDelaiMin
// ('Z' explicite) -- verification best-effort en app (message d'erreur
// clair) ; le filet de securite dur contre le chevauchement brut reste la
// contrainte d'exclusion Postgres, qui ne connait pas le tampon.
// isPlaceBooking : jamais applique a une offre type 'place' -- plusieurs
// reservations legitimement identiques (meme creneau, meme offre, capacite)
// seraient sinon vues comme "trop proches" d'elles-memes.
export async function checkBuffer(supabaseAdmin: any, lieuId: string, date: string, heureDebut: string, heureFin: string, rules: BookingRules, isPlaceBooking = false) {
  if (!rules.buffer_minutes || isPlaceBooking) return
  const debut = new Date(`${date}T${heureDebut}Z`)
  const fin = new Date(`${date}T${heureFin}Z`)
  const fenetreDebut = new Date(debut.getTime() - rules.buffer_minutes * 60_000)
  const fenetreFin = new Date(fin.getTime() + rules.buffer_minutes * 60_000)
  const { data } = await supabaseAdmin
    .from('reservations')
    .select('id, heure_debut, heure_fin')
    .eq('lieu_id', lieuId)
    .eq('date', date)
    .in('statut', ['en_attente', 'confirmee'])
  const conflit = (data || []).some((r: any) => {
    const rDebut = new Date(`${date}T${r.heure_debut}Z`)
    const rFin = new Date(`${date}T${r.heure_fin}Z`)
    return rDebut < fenetreFin && rFin > fenetreDebut
  })
  if (conflit) throw new Error(`Un temps tampon de ${rules.buffer_minutes} min est requis entre deux rendez-vous`)
}

// Montant a capturer immediatement (le reste, s'il y en a un, est charge
// hors-session a la confirmation -- cf confirm-reservation). Pas d'acompte
// configure ou montant sous le seuil -> 100% comme avant cette phase.
export function computeAcompteCents(totalCents: number, rules: BookingRules): number {
  if (!rules.acompte_pourcentage) return totalCents
  if (rules.acompte_seuil_cents != null && totalCents < rules.acompte_seuil_cents) return totalCents
  return Math.max(1, Math.round(totalCents * (rules.acompte_pourcentage / 100)))
}

// Charge le solde restant apres un acompte, hors-session, sur la carte
// enregistree lors du paiement initial (setup_future_usage, cf
// create-payment-intent). Appelee a la confirmation manuelle du
// prestataire (confirm-reservation) ou immediatement si l'organisation
// confirme automatiquement (stripe-webhook, payment_intent.succeeded).
// `resa` doit inclure lieux(stripe_account_id, commission_rate_percent).
// Retourne le PaymentIntent du solde (pour cumuler sa commission avec celle
// de l'acompte) ou null si aucun solde n'etait a charger.
export async function chargeSolde(stripe: any, supabaseAdmin: any, resa: any): Promise<any | null> {
  if (resa.solde_statut !== 'a_charger') return null
  const soldeCents = Math.round(Number(resa.montant_ht) * 100) - (resa.acompte_cents || 0)
  if (soldeCents <= 0) {
    await supabaseAdmin.from('reservations').update({ solde_statut: 'paye' }).eq('id', resa.id)
    return null
  }
  const depositPi = await stripe.paymentIntents.retrieve(resa.stripe_payment_intent_id)
  const customerId = depositPi.customer as string | null
  const paymentMethodId = depositPi.payment_method as string | null
  if (!customerId || !paymentMethodId) {
    await supabaseAdmin.from('reservations').update({ solde_statut: 'echoue' }).eq('id', resa.id)
    throw new Error('Moyen de paiement du solde introuvable')
  }

  try {
    const percent = await resolveCommissionPercent(supabaseAdmin, resa.lieu_id)
    const solde = await stripe.paymentIntents.create({
      amount: soldeCents,
      currency: 'eur',
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      application_fee_amount: Math.round(soldeCents * (percent / 100)),
      transfer_data: { destination: resa.lieux?.stripe_account_id },
      metadata: { reservation_id: resa.id, kind: 'solde_reservation' },
    })
    await supabaseAdmin.from('reservations').update({ solde_statut: 'paye', solde_stripe_payment_intent_id: solde.id }).eq('id', resa.id)
    return solde
  } catch (e) {
    await supabaseAdmin.from('reservations').update({ solde_statut: 'echoue' }).eq('id', resa.id)
    throw e
  }
}
