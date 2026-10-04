import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

Deno.serve(async (req) => {
  // Cle API utilisee uniquement pour les appels reservation/Connect (test mode).
  // Les abonnements pro (checkout.session.completed / customer.subscription.*)
  // sont en LIVE mode sur ce meme compte Stripe : on ne fait jamais d'appel API
  // avec cette cle pour ces evenements-la (voir plus bas), seule la verification
  // de signature differe (secret test vs secret live, essayes l'un puis l'autre).
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' })
  const webhookSecrets = [Deno.env.get('STRIPE_WEBHOOK_SECRET'), Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')].filter(Boolean) as string[]

  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event | null = null
  let lastErr: Error | null = null
  if (signature) {
    for (const secret of webhookSecrets) {
      try {
        event = await stripe.webhooks.constructEventAsync(body, signature, secret)
        break
      } catch (err) {
        lastErr = err
      }
    }
  }
  if (!event) {
    console.error('Signature Stripe invalide:', lastErr?.message ?? 'signature manquante')
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

        // Achat de forfait (plusieurs seances) : rien a voir avec une ligne
        // reservations existante, on cree directement le credit de seances.
        if (pi.metadata?.kind === 'forfait_achat') {
          const validiteJours = pi.metadata.validite_jours ? Number(pi.metadata.validite_jours) : null
          const dateExpiration = validiteJours
            ? new Date(Date.now() + validiteJours * 86_400_000).toISOString().slice(0, 10)
            : null
          await supabaseAdmin.from('forfaits_achetes').insert({
            forfait_id: pi.metadata.forfait_id,
            lieu_id: pi.metadata.lieu_id,
            user_id: pi.metadata.user_id,
            nb_seances_total: Number(pi.metadata.nb_seances),
            prix_paye: Number(pi.metadata.prix),
            stripe_payment_intent_id: pi.id,
            date_expiration: dateExpiration,
          })
          break
        }

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

      // Abonnement SaaS pro (starter/essentiel/pro/premium) — distinct du Connect
      // ci-dessus, qui concerne les paiements reservation/commission encaisses par
      // l'educateur. client_reference_id est pose cote client (espace-pro.html,
      // tagStripeSubscriptionLinks) car les Payment Links sont statiques et ne
      // portent aucun contexte par defaut.
      //
      // Volontairement aucun appel a l'API Stripe (stripe.subscriptions.retrieve
      // etc.) dans ce webhook pour ces evenements : la cle configuree ici est en
      // mode test, alors que ces abonnements sont en live sur le meme compte. On
      // ne se sert que des donnees deja incluses dans le payload de l'evenement.
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription' || !session.client_reference_id) break
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
        await supabaseAdmin
          .from('lieux')
          .update({
            stripe_subscription_customer_id: customerId ?? null,
            stripe_subscription_id: subscriptionId ?? null,
            // Statut optimiste : checkout.session.completed n'est envoye qu'apres
            // succes du paiement initial. L'evenement customer.subscription.created
            // (quasi simultane) corrige/confirme juste apres avec le statut exact.
            subscription_status: 'active',
          })
          .eq('id', session.client_reference_id)
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        // unit_amount/interval viennent directement de l'objet Subscription
        // standard inclus dans l'evenement (sub.items.data[0].price) -- pas
        // d'appel API necessaire, donc pas de probleme avec le decalage
        // cle test/live mentionne plus haut dans ce fichier.
        const price = sub.items?.data?.[0]?.price
        await supabaseAdmin
          .from('lieux')
          .update({
            subscription_status: sub.status,
            subscription_current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            subscription_amount_cents: price?.unit_amount ?? null,
            subscription_interval: price?.recurring?.interval ?? null,
            // Pose uniquement a la creation (jamais ecrase par un update
            // ulterieur) -- sert de point de depart pour le NPS "30j apres
            // l'abonnement" (Phase 6 lot 5).
            ...(event.type === 'customer.subscription.created' ? { subscription_started_at: new Date().toISOString() } : {}),
          })
          .eq('stripe_subscription_id', sub.id)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await supabaseAdmin
          .from('lieux')
          .update({ subscription_status: 'canceled', subscription_canceled_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id)
        break
      }

      // Factures d'abonnement pro -- memes contraintes que les evenements
      // customer.subscription.* ci-dessus : aucun appel API Stripe, on ne lit
      // que le payload de l'Invoice deja fourni par l'evenement. Rattachement
      // au compte (lieux ou partenaires, cf schema Phase 5) via
      // stripe_subscription_customer_id ; si aucun match, la facture est tout
      // de meme stockee (customer_table/customer_id a null) plutot que perdue.
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.voided': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
        if (!customerId) break

        let customerTable: 'lieux' | 'partenaires' | null = null
        let customerRowId: string | null = null
        const { data: lieu } = await supabaseAdmin
          .from('lieux').select('id').eq('stripe_subscription_customer_id', customerId).maybeSingle()
        if (lieu) {
          customerTable = 'lieux'
          customerRowId = lieu.id
        } else {
          const { data: partenaire } = await supabaseAdmin
            .from('partenaires').select('id').eq('stripe_subscription_customer_id', customerId).maybeSingle()
          if (partenaire) {
            customerTable = 'partenaires'
            customerRowId = partenaire.id
          }
        }

        const status = event.type === 'invoice.voided' ? 'void' : (invoice.status ?? (event.type === 'invoice.paid' ? 'paid' : 'open'))
        await supabaseAdmin.from('stripe_invoices').upsert({
          stripe_invoice_id: invoice.id,
          stripe_customer_id: customerId,
          customer_table: customerTable,
          customer_id: customerRowId,
          amount_cents: event.type === 'invoice.paid' ? invoice.amount_paid : invoice.amount_due,
          currency: invoice.currency ?? 'eur',
          status,
          hosted_invoice_url: invoice.hosted_invoice_url ?? null,
          invoice_pdf_url: invoice.invoice_pdf ?? null,
          invoice_created_at: new Date(invoice.created * 1000).toISOString(),
          paid_at: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : null,
        }, { onConflict: 'stripe_invoice_id' })
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
