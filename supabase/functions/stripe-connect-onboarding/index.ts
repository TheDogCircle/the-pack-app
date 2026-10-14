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

    const { lieu_id } = await req.json()
    if (!lieu_id) throw new Error('lieu_id manquant')

    const { data: lieu, error: lieuErr } = await supabaseAdmin
      .from('lieux')
      .select('id, nom, manager_user_id, stripe_account_id')
      .eq('id', lieu_id)
      .maybeSingle()
    if (lieuErr) throw lieuErr
    if (!lieu) throw new Error('Lieu introuvable')

    // Autorise le manager_user_id historique (inchange) OU un owner/manager
    // de l'organisation rattachee via org_places (socle commun) -- avant
    // cette phase, un owner/manager passe par le rebranchement socle commun
    // sans etre ce manager_user_id direct ne pouvait pas connecter Stripe
    // pour son propre lieu. is_org_member() (fonction SQL utilisee par la
    // RLS) s'appuie sur auth.uid(), toujours null avec le client service
    // role utilise ici -- on reproduit donc la meme hierarchie de role a la
    // main, directement sur org_members (le service role contourne la RLS,
    // lecture simple).
    const { data: place } = await supabaseAdmin.from('org_places').select('org_id').eq('lieu_id', lieu_id).eq('statut', 'approved').maybeSingle()
    let isAuthorized = lieu.manager_user_id === caller.id
    if (!isAuthorized && place?.org_id) {
      const { data: membership } = await supabaseAdmin
        .from('org_members').select('role').eq('org_id', place.org_id).eq('user_id', caller.id).eq('status', 'active').maybeSingle()
      const roleRank: Record<string, number> = { owner: 3, manager: 2, staff: 1 }
      isAuthorized = !!membership && (roleRank[membership.role] ?? 0) >= 2
    }
    if (!isAuthorized) throw new Error('Non autorisé sur ce lieu')

    let accountId = lieu.stripe_account_id as string | null

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        email: caller.email,
        business_type: 'individual',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: { name: lieu.nom || undefined },
      })
      accountId = account.id
      const { error: updErr } = await supabaseAdmin
        .from('lieux')
        .update({ stripe_account_id: accountId, stripe_onboarding_status: 'pending' })
        .eq('id', lieu_id)
      if (updErr) throw updErr
      // Miroir sur organizations (socle commun) -- meme convention que le
      // reste de la transition : deux colonnes alimentees en parallele,
      // jamais une seule source retiree sans migration dediee.
      if (place?.org_id) {
        await supabaseAdmin.from('organizations').update({ stripe_connect_account_id: accountId }).eq('id', place.org_id)
      }
    } else {
      // Synchronise le statut a chaque appel, en attendant que le webhook account.updated
      // (etape 2) prenne le relais en temps reel.
      const account = await stripe.accounts.retrieve(accountId)
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
        .eq('id', lieu_id)
    }

    const origin = req.headers.get('origin') || 'https://thepackclub.fr'
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/espace-pro.html?stripe_refresh=1`,
      return_url: `${origin}/espace-pro.html?stripe_return=1`,
      type: 'account_onboarding',
    })

    return new Response(JSON.stringify({ url: accountLink.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
