import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

Deno.serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' })
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event
  try {
    if (!signature) throw new Error('Signature manquante')
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
  } catch (err) {
    console.error('Signature Stripe invalide:', err.message)
    return new Response('Signature invalide', { status: 400 })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent
        const commission = (pi.application_fee_amount ?? 0) / 100

        const { data: resa, error } = await supabaseAdmin
          .from('reservations')
          .update({ statut: 'confirmee', statut_paiement: 'paye', montant_commission: commission })
          .eq('stripe_payment_intent_id', pi.id)
          .select('*')
          .maybeSingle()
        if (error) throw error

        if (resa) {
          const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-reservation`
          await fetch(notifyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ record: resa }),
          }).catch((e) => console.error('notify-reservation call failed:', e.message))
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        await supabaseAdmin
          .from('reservations')
          .update({ statut: 'annulee', statut_paiement: 'echoue' })
          .eq('stripe_payment_intent_id', pi.id)
        break
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account
        const status = account.details_submitted
          ? (account.charges_enabled ? 'active' : 'restricted')
          : 'pending'
        await supabaseAdmin
          .from('lieux')
          .update({
            stripe_onboarding_status: status,
            stripe_charges_enabled: !!account.charges_enabled,
            stripe_payouts_enabled: !!account.payouts_enabled,
          })
          .eq('stripe_account_id', account.id)
        break
      }
    }
  } catch (err) {
    console.error('Erreur traitement webhook Stripe:', err.message)
    return new Response('Erreur interne', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
