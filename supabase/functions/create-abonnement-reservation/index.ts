import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { resolveOfferPrice } from '../_shared/offerPricing.ts'
import { resolveCommissionPercent } from '../_shared/commission.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Phase Pro 5 : reservation recurrente (offre type 'abonnement', ex. "5
// balades par semaine"). Une vraie Stripe Subscription -- pas un
// re-prelevement maison hebdomadaire reconstruit a la main -- avec un prix
// cree a la volee (price_data, pas de Price pre-cree en base) et
// application_fee_percent + transfer_data pour la commission Connect,
// prelevee automatiquement par Stripe a chaque facture, pas recalculee ici.
// Le premier paiement (et l'enregistrement de la carte comme moyen de
// paiement par defaut de l'abonnement) est confirme cote client comme un
// paiement normal (client_secret) ; chaque facture suivante materialise la
// prochaine reservation via stripe-webhook (invoice.paid).
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

    const { offer_id, chien_id, jour_semaine, heure_debut } = await req.json()
    if (!offer_id || jour_semaine == null || !heure_debut) throw new Error('Champs manquants')

    const { data: offerRow, error: offerErr } = await supabaseAdmin.from('offers').select('lieu_id, type').eq('id', offer_id).maybeSingle()
    if (offerErr) throw offerErr
    if (!offerRow) throw new Error('Offre introuvable')
    if (offerRow.type !== 'abonnement') throw new Error("Cette offre n'est pas un abonnement")

    const resolved = await resolveOfferPrice(supabaseAdmin, offer_id, offerRow.lieu_id, {})
    if (!resolved.offerPrice.intervalle) throw new Error('Configuration de l\'offre incomplète (intervalle manquant)')
    if (!resolved.legacyPrestationId) throw new Error('Configuration de l\'offre incomplète (contactez le support)')

    const { data: lieu, error: lieuErr } = await supabaseAdmin
      .from('lieux').select('id, stripe_account_id, stripe_charges_enabled').eq('id', offerRow.lieu_id).maybeSingle()
    if (lieuErr) throw lieuErr
    if (!lieu) throw new Error('Lieu introuvable')
    const { data: place } = await supabaseAdmin.from('org_places').select('org_id').eq('lieu_id', offerRow.lieu_id).eq('statut', 'approved').maybeSingle()
    const { data: canReserve } = place?.org_id
      ? await supabaseAdmin.rpc('org_has_feature', { p_org_id: place.org_id, p_feature: 'reservation_paiement_en_ligne' })
      : { data: false }
    if (!canReserve) throw new Error("Ce lieu n'a pas accès aux réservations en ligne")
    if (!lieu.stripe_account_id || !lieu.stripe_charges_enabled) {
      throw new Error("Ce prestataire n'a pas encore activé les paiements en ligne")
    }

    const { data: profil } = await supabaseAdmin.from('profils').select('stripe_customer_id').eq('id', caller.id).maybeSingle()
    let customerId = profil?.stripe_customer_id || null
    if (!customerId) {
      const customer = await stripe.customers.create({ email: caller.email || undefined, metadata: { user_id: caller.id } })
      customerId = customer.id
      await supabaseAdmin.from('profils').update({ stripe_customer_id: customerId }).eq('id', caller.id)
    }

    const percent = await resolveCommissionPercent(supabaseAdmin, offerRow.lieu_id)
    const interval = resolved.offerPrice.intervalle === 'semaine' ? 'week' : 'month'

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{
        price_data: {
          currency: 'eur',
          unit_amount: resolved.offerPrice.prix_cents,
          recurring: { interval },
          product_data: { name: resolved.offer.nom },
        },
      }],
      application_fee_percent: percent,
      transfer_data: { destination: lieu.stripe_account_id },
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: {
        kind: 'abonnement_reservation',
        offer_id,
        offer_price_id: resolved.offerPrice.id,
        lieu_id: offerRow.lieu_id,
        user_id: caller.id,
        chien_id: chien_id || '',
        jour_semaine: String(jour_semaine),
        heure_debut,
      },
      expand: ['latest_invoice.payment_intent'],
    })

    const { data: abonnement, error: insertErr } = await supabaseAdmin
      .from('abonnements_reservations')
      .insert({
        offer_id, offer_price_id: resolved.offerPrice.id, user_id: caller.id, lieu_id: offerRow.lieu_id,
        chien_id: chien_id || null, jour_semaine, heure_debut, statut: 'actif', stripe_subscription_id: subscription.id,
      })
      .select('id').single()
    if (insertErr) {
      await stripe.subscriptions.cancel(subscription.id).catch(() => {})
      throw insertErr
    }

    const invoice = subscription.latest_invoice as Stripe.Invoice
    const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent
    return new Response(JSON.stringify({
      abonnement_id: abonnement.id,
      client_secret: paymentIntent?.client_secret ?? null,
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
