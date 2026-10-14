import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { chargeSolde } from '../_shared/offerPricing.ts'
import { recordBookingRevenue } from '../_shared/revenueEvents.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Appelee quand le prestataire accepte une demande de reservation : capture
// reellement le paiement (jusque-la seulement autorise, cf. create-payment-
// intent) -- c'est ce capture qui debite le client et declenche le transfert
// Connect + la commission. Le webhook Stripe (payment_intent.succeeded) fait
// ensuite la mise a jour officielle du statut + la notification client ; on
// met aussi a jour ici en direct pour un retour immediat dans l'espace pro.
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

    const { reservation_id } = await req.json()
    if (!reservation_id) throw new Error('reservation_id manquant')

    const { data: resa, error: resaErr } = await supabaseAdmin
      .from('reservations')
      .select('id, lieu_id, statut, statut_paiement, stripe_payment_intent_id, forfait_achete_id, montant_ht, acompte_cents, solde_statut, lieux(manager_user_id, stripe_account_id, commission_rate_percent)')
      .eq('id', reservation_id)
      .maybeSingle()
    if (resaErr) throw resaErr
    if (!resa) throw new Error('Réservation introuvable')

    // Recette Phase Pro 5 : ce check n'acceptait que le manager_user_id
    // historique -- un membre staff/manager d'une organisation (jamais
    // rebranche ici, meme en Phase Pro 4) ne pouvait pas confirmer une
    // reservation, contrairement a ce que permet desormais l'Agenda cote
    // UI (staff compris, cf docs/pro-v2.md Phase Pro 3). 'staff' minimum --
    // meme seuil que reservations_org_write.
    const managerUserId = (resa as any).lieux?.manager_user_id
    let isPro = !!managerUserId && managerUserId === caller.id
    if (!isPro) {
      const { data: place } = await supabaseAdmin.from('org_places').select('org_id').eq('lieu_id', resa.lieu_id).eq('statut', 'approved').maybeSingle()
      if (place?.org_id) {
        const { data: membership } = await supabaseAdmin
          .from('org_members').select('role').eq('org_id', place.org_id).eq('user_id', caller.id).eq('status', 'active').maybeSingle()
        const roleRank: Record<string, number> = { owner: 3, manager: 2, staff: 1 }
        isPro = !!membership && (roleRank[membership.role] ?? 0) >= 1
      }
    }
    if (!isPro) throw new Error('Non autorisé sur cette réservation')

    if (resa.statut !== 'en_attente') throw new Error('Cette réservation ne peut plus être confirmée')

    // Seance payee via un forfait deja achete : le credit n'est decompte qu'a
    // la confirmation (pas a la demande), pour ne rien consommer si le
    // prestataire refuse.
    if (resa.forfait_achete_id) {
      const { data: achat, error: achatErr } = await supabaseAdmin
        .from('forfaits_achetes').select('nb_seances_total, nb_seances_utilisees').eq('id', resa.forfait_achete_id).maybeSingle()
      if (achatErr) throw achatErr
      if (!achat || achat.nb_seances_utilisees >= achat.nb_seances_total) {
        throw new Error('Plus de séance disponible sur ce forfait')
      }
      await supabaseAdmin.from('forfaits_achetes').update({ nb_seances_utilisees: achat.nb_seances_utilisees + 1 }).eq('id', resa.forfait_achete_id)
      await supabaseAdmin.from('reservations').update({ statut: 'confirmee' }).eq('id', reservation_id)
      return new Response(JSON.stringify({ confirmed: true, captured: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Reservation web historique, jamais liee a un paiement en ligne : simple
    // changement de statut, comme avant.
    if (!resa.stripe_payment_intent_id) {
      await supabaseAdmin.from('reservations').update({ statut: 'confirmee' }).eq('id', reservation_id)
      return new Response(JSON.stringify({ confirmed: true, captured: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Avec un acompte (Phase Pro 4), le paiement initial est deja capture
    // automatiquement des la reservation (cf create-payment-intent) -- le
    // statut attendu ici est 'acompte_paye', pas 'en_attente'. Sans acompte,
    // comportement inchange : seule une premiere capture est autorisee.
    const acomptePending = resa.solde_statut === 'a_charger' && resa.statut_paiement === 'acompte_paye'
    if (!acomptePending && resa.statut_paiement !== 'en_attente') {
      throw new Error('Le paiement de cette réservation a déjà été traité')
    }

    let commission: number
    if (acomptePending) {
      // L'acompte est deja capture ; seul le solde reste a charger hors-session.
      const soldePi = await chargeSolde(stripe, supabaseAdmin, resa)
      const depositPi = await stripe.paymentIntents.retrieve(resa.stripe_payment_intent_id)
      commission = ((depositPi.application_fee_amount ?? 0) + (soldePi?.application_fee_amount ?? 0)) / 100
    } else {
      const paymentIntent = await stripe.paymentIntents.capture(resa.stripe_payment_intent_id)
      commission = (paymentIntent.application_fee_amount ?? 0) / 100
    }

    await supabaseAdmin
      .from('reservations')
      .update({ statut: 'confirmee', statut_paiement: 'paye', montant_commission: commission })
      .eq('id', reservation_id)

    // revenue_events (socle commun, Phase Pro 5) : le paiement est reellement
    // capture/charge a cet instant (transfert Connect + commission executes
    // par Stripe), c'est le bon moment pour ecrire la ligne -- pas a la
    // creation du PaymentIntent (create-payment-intent), qui ne fait
    // qu'autoriser.
    await recordBookingRevenue(supabaseAdmin, {
      lieuId: resa.lieu_id,
      grossCents: Math.round(Number(resa.montant_ht) * 100),
      commissionCents: Math.round(commission * 100),
      externalRef: resa.stripe_payment_intent_id,
    })

    return new Response(JSON.stringify({ confirmed: true, captured: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
