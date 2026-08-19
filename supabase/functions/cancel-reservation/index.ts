import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { reservation_id } = await req.json()
    if (!reservation_id) throw new Error('reservation_id manquant')

    const { data: resa, error: resaErr } = await supabaseAdmin
      .from('reservations')
      .select('id, lieu_id, user_id, date, heure_debut, statut, statut_paiement, montant_ht, stripe_payment_intent_id, lieux(manager_user_id)')
      .eq('id', reservation_id)
      .maybeSingle()
    if (resaErr) throw resaErr
    if (!resa) throw new Error('Réservation introuvable')

    const managerUserId = (resa as any).lieux?.manager_user_id
    const isClient = resa.user_id === caller.id
    const isPro = !!managerUserId && managerUserId === caller.id
    if (!isClient && !isPro) throw new Error('Non autorisé sur cette réservation')

    if (resa.statut === 'annulee' || resa.statut === 'terminee') {
      throw new Error('Cette réservation ne peut plus être annulée')
    }

    // Reservation non payee (flux web gratuit historique) : simple annulation, pas de Stripe.
    if (!resa.stripe_payment_intent_id || resa.statut_paiement === 'non_requis') {
      await supabaseAdmin.from('reservations').update({ statut: 'annulee' }).eq('id', reservation_id)
      return new Response(JSON.stringify({ cancelled: true, refunded: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (resa.statut_paiement !== 'paye') {
      throw new Error('Le paiement de cette réservation n\'est pas encore confirmé')
    }

    // Le pro annulant rembourse toujours a 100% et ne garde pas sa commission.
    // Le client beneficie de 100% si annulation >=24h avant le RDV, 50% sinon.
    // La date/heure du RDV n'a pas de fuseau explicite en base : on la traite
    // en UTC, precision suffisante pour un seuil exprime en heures pleines.
    let refundPercent = 1
    if (isClient) {
      const rdvDate = new Date(`${resa.date}T${resa.heure_debut}Z`)
      const hoursUntil = (rdvDate.getTime() - Date.now()) / 3_600_000
      refundPercent = hoursUntil >= 24 ? 1 : 0.5
    }

    const totalCents = Math.round(Number(resa.montant_ht) * 100)
    const refundAmountCents = Math.round(totalCents * refundPercent)

    // refund_application_fee: Stripe rembourse automatiquement une part de la
    // commission proportionnelle au montant rembourse — jamais la commission
    // sur la part effectivement conservee par le prestataire.
    const refund = await stripe.refunds.create({
      payment_intent: resa.stripe_payment_intent_id,
      amount: refundAmountCents,
      refund_application_fee: true,
    })

    const montantRembourse = refundAmountCents / 100
    await supabaseAdmin
      .from('reservations')
      .update({
        statut: 'annulee',
        statut_paiement: 'rembourse',
        montant_rembourse: montantRembourse,
      })
      .eq('id', reservation_id)

    return new Response(JSON.stringify({
      cancelled: true,
      refunded: true,
      refund_id: refund.id,
      montant_rembourse: montantRembourse,
      refund_percent: refundPercent,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
