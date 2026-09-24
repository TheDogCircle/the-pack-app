import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

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
      .select('id, statut, statut_paiement, stripe_payment_intent_id, lieux(manager_user_id)')
      .eq('id', reservation_id)
      .maybeSingle()
    if (resaErr) throw resaErr
    if (!resa) throw new Error('Réservation introuvable')

    const managerUserId = (resa as any).lieux?.manager_user_id
    if (!managerUserId || managerUserId !== caller.id) throw new Error('Non autorisé sur cette réservation')

    if (resa.statut !== 'en_attente') throw new Error('Cette réservation ne peut plus être confirmée')

    // Reservation web historique, jamais liee a un paiement en ligne : simple
    // changement de statut, comme avant.
    if (!resa.stripe_payment_intent_id) {
      await supabaseAdmin.from('reservations').update({ statut: 'confirmee' }).eq('id', reservation_id)
      return new Response(JSON.stringify({ confirmed: true, captured: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (resa.statut_paiement !== 'en_attente') throw new Error('Le paiement de cette réservation a déjà été traité')

    const paymentIntent = await stripe.paymentIntents.capture(resa.stripe_payment_intent_id)
    const commission = (paymentIntent.application_fee_amount ?? 0) / 100

    await supabaseAdmin
      .from('reservations')
      .update({ statut: 'confirmee', statut_paiement: 'paye', montant_commission: commission })
      .eq('id', reservation_id)

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
