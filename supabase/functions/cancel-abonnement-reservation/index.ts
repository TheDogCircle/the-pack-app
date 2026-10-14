import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Annule une reservation recurrente (Phase Pro 5) : annule la Stripe
// Subscription (effet immediat -- pas de prorata, meme logique que
// "aucun delai de grace" sur une resiliation volontaire d'abonnement pro,
// cf stripe-webhook customer.subscription.deleted). Ne touche jamais les
// reservations deja materialisees (occurrences passees/en cours) -- celles-ci
// s'annulent normalement via cancel-reservation si besoin.
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

    const { abonnement_id } = await req.json()
    if (!abonnement_id) throw new Error('abonnement_id manquant')

    const { data: abonnement, error: aErr } = await supabaseAdmin
      .from('abonnements_reservations').select('id, user_id, statut, stripe_subscription_id, lieux:lieu_id(manager_user_id)')
      .eq('id', abonnement_id).maybeSingle()
    if (aErr) throw aErr
    if (!abonnement) throw new Error('Abonnement introuvable')
    const isClient = abonnement.user_id === caller.id
    const isPro = (abonnement as any).lieux?.manager_user_id === caller.id
    if (!isClient && !isPro) throw new Error('Non autorisé')
    if (abonnement.statut === 'annule') throw new Error('Cet abonnement est déjà annulé')

    if (abonnement.stripe_subscription_id) {
      await stripe.subscriptions.cancel(abonnement.stripe_subscription_id).catch((e) => {
        // Deja annule cote Stripe (ex: facture impayee ayant deja resilie) --
        // pas bloquant, on aligne tout de meme notre statut local.
        console.error('stripe.subscriptions.cancel:', e.message)
      })
    }
    await supabaseAdmin.from('abonnements_reservations').update({ statut: 'annule' }).eq('id', abonnement_id)

    return new Response(JSON.stringify({ cancelled: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
