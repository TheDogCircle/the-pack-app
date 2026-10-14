import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { resolveOfferPrice, applyRemiseMembre, getBookingRules, checkDelaiMin, checkConges, checkBuffer, computeAcompteCents } from '../_shared/offerPricing.ts'
import { resolveCommissionPercent } from '../_shared/commission.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Une reservation "en_attente" plus vieille que ce delai est consideree
// abandonnee (paiement jamais termine) et ne bloque plus le creneau.
const ABANDON_MINUTES = 15

function addMinutes(hhmmss: string, minutes: number): string {
  const [h, m, s] = hhmmss.split(':').map(Number)
  const total = h * 60 + m + minutes
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(s || 0).padStart(2, '0')}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Non autorisé')
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !caller) throw new Error('Non autorisé')

    // Phase Pro 4 : offer_id remplace prestation_id cote client -- gabarit/
    // type_poil/duree_minutes selectionnent la variante de prix (offer_prices)
    // quand l'offre en a plusieurs (cf resolveOfferPrice).
    const { lieu_id, offer_id, gabarit, type_poil, duree_minutes, date, heure_debut, client_prenom, client_tel } = await req.json()
    if (!lieu_id || !offer_id || !date || !heure_debut || !client_prenom) {
      throw new Error('Champs manquants')
    }

    const { data: lieu, error: lieuErr } = await supabaseAdmin
      .from('lieux').select('id, nom, stripe_account_id, stripe_charges_enabled').eq('id', lieu_id).maybeSingle()
    if (lieuErr) throw lieuErr
    if (!lieu) throw new Error('Lieu introuvable')

    const { data: place } = await supabaseAdmin.from('org_places').select('org_id').eq('lieu_id', lieu_id).eq('statut', 'approved').maybeSingle()
    const { data: canReserve } = place?.org_id
      ? await supabaseAdmin.rpc('org_has_feature', { p_org_id: place.org_id, p_feature: 'reservation_paiement_en_ligne' })
      : { data: false }
    if (!canReserve) throw new Error("Ce lieu n'a pas accès aux réservations en ligne")
    if (!lieu.stripe_account_id || !lieu.stripe_charges_enabled) {
      throw new Error("Ce prestataire n'a pas encore activé les paiements en ligne")
    }

    const resolved = await resolveOfferPrice(supabaseAdmin, offer_id, lieu_id, { gabarit, typePoil: type_poil, dureeMinutes: duree_minutes })
    const heure_fin = addMinutes(heure_debut, resolved.dureeMinutes)

    const rules = await getBookingRules(supabaseAdmin, place?.org_id ?? null)
    checkDelaiMin(date, heure_debut, rules)
    await checkConges(supabaseAdmin, lieu_id, date)
    await checkBuffer(supabaseAdmin, lieu_id, date, heure_debut, heure_fin, rules, resolved.offer.type === 'place')

    // Verifie la disponibilite cote serveur (le calcul de carte.html est purement client).
    // disponibilites.jour suit la convention 0=lundi...6=dimanche (cf. espace-pro.html),
    // pas le getDay() natif de JS/Date qui est 0=dimanche : on convertit.
    const jour = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
    const { data: dispo, error: dispoErr } = await supabaseAdmin
      .from('disponibilites')
      .select('heure_debut, heure_fin')
      .eq('lieu_id', lieu_id)
      .eq('jour', jour)
      .maybeSingle()
    if (dispoErr) throw dispoErr
    if (!dispo || heure_debut < dispo.heure_debut || heure_fin > dispo.heure_fin) {
      throw new Error("Ce créneau n'est pas disponible")
    }

    // Libere les reservations "en_attente" abandonnees sur ce creneau precis
    await supabaseAdmin
      .from('reservations')
      .update({ statut: 'annulee', statut_paiement: 'echoue' })
      .eq('lieu_id', lieu_id)
      .eq('date', date)
      .eq('heure_debut', heure_debut)
      .eq('statut', 'en_attente')
      .lt('created_at', new Date(Date.now() - ABANDON_MINUTES * 60_000).toISOString())

    const percent = await resolveCommissionPercent(supabaseAdmin, lieu_id)

    const { data: profil } = await supabaseAdmin.from('profils').select('ambassadeur, stripe_customer_id').eq('id', caller.id).maybeSingle()
    const totalCents = applyRemiseMembre(resolved.prixCents, resolved.options, !!profil?.ambassadeur)
    const acompteCents = computeAcompteCents(totalCents, rules)
    const soldeACharger = acompteCents < totalCents
    // L'offre peut imposer sa propre confirmation manuelle meme si
    // l'organisation autorise la confirmation automatique par defaut.
    const autoConfirm = !resolved.offer.confirmation_manuelle && rules.confirmation_auto

    if (!resolved.legacyPrestationId) throw new Error('Configuration de l\'offre incomplète (contactez le support)')

    const { data: reservation, error: insertErr } = await supabaseAdmin
      .from('reservations')
      .insert({
        lieu_id, prestation_id: resolved.legacyPrestationId, offer_id, offer_price_id: resolved.offerPrice.id,
        user_id: caller.id,
        client_prenom, client_tel: client_tel || null,
        client_email: caller.email || null,
        date, heure_debut, heure_fin,
        is_place_booking: resolved.offer.type === 'place',
        statut: 'en_attente',
        statut_paiement: 'en_attente',
        montant_ht: totalCents / 100,
        acompte_cents: acompteCents,
        solde_statut: soldeACharger ? 'a_charger' : 'non_applicable',
      })
      .select('id')
      .single()

    if (insertErr) {
      // 23505 : ancien index unique (heure_debut exact). 23P01 : nouvelle
      // contrainte d'exclusion Postgres (chevauchement reel, cf migration
      // Phase Pro 5 reservations_no_double_booking) -- deux clients qui
      // reservent le meme crenau en meme temps, un seul passe.
      if (insertErr.code === '23505' || insertErr.code === '23P01') throw new Error('Ce créneau vient d\'être réservé par quelqu\'un d\'autre')
      // P0001 : raise exception explicite du trigger check_place_capacity
      // (offre type 'place', capacite_max atteinte).
      if (insertErr.code === 'P0001') throw new Error(insertErr.message || 'Capacité atteinte pour ce créneau')
      throw insertErr
    }

    // Client Stripe uniquement necessaire si un solde devra etre charge hors-
    // session plus tard (cf confirm-reservation) -- sinon comportement
    // inchange (simple autorisation, un seul paiement).
    let customerId: string | undefined
    if (soldeACharger) {
      customerId = profil?.stripe_customer_id || undefined
      if (!customerId) {
        const customer = await stripe.customers.create({ email: caller.email || undefined, metadata: { user_id: caller.id } })
        customerId = customer.id
        await supabaseAdmin.from('profils').update({ stripe_customer_id: customerId }).eq('id', caller.id)
      }
    }

    const commissionCents = Math.round(acompteCents * (percent / 100))

    let paymentIntent
    try {
      // Sans acompte et confirmation manuelle (cas le plus courant, comportement
      // inchange par rapport a avant cette phase) : capture_method 'manual',
      // la carte est autorisee mais jamais debitee tant que le prestataire
      // n'a pas confirme (cf confirm-reservation). Un acompte est toujours
      // capture immediatement (il engage le client des la reservation, meme
      // si le prestataire n'a pas encore repondu) ; une confirmation
      // automatique capture aussi tout de suite. Carte enregistree via
      // setup_future_usage des qu'un solde devra etre charge hors-session.
      paymentIntent = await stripe.paymentIntents.create({
        amount: acompteCents,
        currency: 'eur',
        payment_method_types: ['card'],
        capture_method: (soldeACharger || autoConfirm) ? 'automatic' : 'manual',
        ...(soldeACharger ? { customer: customerId, setup_future_usage: 'off_session' } : {}),
        application_fee_amount: commissionCents,
        transfer_data: { destination: lieu.stripe_account_id },
        metadata: { reservation_id: reservation.id, lieu_id, offer_id },
      })
    } catch (stripeErr) {
      await supabaseAdmin.from('reservations').delete().eq('id', reservation.id)
      throw stripeErr
    }

    await supabaseAdmin
      .from('reservations')
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq('id', reservation.id)

    return new Response(JSON.stringify({ client_secret: paymentIntent.client_secret, reservation_id: reservation.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
