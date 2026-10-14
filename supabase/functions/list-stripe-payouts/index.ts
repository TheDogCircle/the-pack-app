import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Phase Pro 5, page "Paiements & virements" : liste les virements Stripe
// reels du compte Connect du lieu -- jamais la cle secrete cote client. Les
// payouts d'un compte Express appartiennent au solde DU COMPTE CONNECTE,
// pas de la plateforme : on les liste avec l'option stripeAccount (agit "pour
// le compte de"), pas un filtre destination sur le solde de la plateforme.
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

    const { lieu_id } = await req.json()
    if (!lieu_id) throw new Error('lieu_id manquant')

    const { data: lieu, error: lieuErr } = await supabaseAdmin
      .from('lieux').select('manager_user_id, stripe_account_id').eq('id', lieu_id).maybeSingle()
    if (lieuErr) throw lieuErr
    if (!lieu) throw new Error('Lieu introuvable')

    let isAuthorized = lieu.manager_user_id === caller.id
    if (!isAuthorized) {
      const { data: place } = await supabaseAdmin.from('org_places').select('org_id').eq('lieu_id', lieu_id).eq('statut', 'approved').maybeSingle()
      if (place?.org_id) {
        const { data: membership } = await supabaseAdmin
          .from('org_members').select('role').eq('org_id', place.org_id).eq('user_id', caller.id).eq('status', 'active').maybeSingle()
        const roleRank: Record<string, number> = { owner: 3, manager: 2, staff: 1 }
        isAuthorized = !!membership && (roleRank[membership.role] ?? 0) >= 2
      }
    }
    if (!isAuthorized) throw new Error('Non autorisé sur ce lieu')
    if (!lieu.stripe_account_id) throw new Error("Ce lieu n'a pas de compte Stripe connecté")

    const payouts = await stripe.payouts.list({ limit: 25 }, { stripeAccount: lieu.stripe_account_id })

    return new Response(JSON.stringify({
      payouts: payouts.data.map((p) => ({
        id: p.id, amount_cents: p.amount, currency: p.currency, status: p.status,
        arrival_date: new Date(p.arrival_date * 1000).toISOString(),
        created: new Date(p.created * 1000).toISOString(),
      })),
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
