import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Portail client Stripe (gerer moyen de paiement, voir factures passees,
// annuler) -- rien de similaire n'existait avant (verifie en explorant les
// deux repos avant d'ecrire cette fonction). Reserve a owner/manager de
// l'organisation, meme seuil que choosePlan()/connectStripe() dans
// espace-pro.html (staff ne gere pas la facturation).
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

    const { org_id, return_url } = await req.json()
    if (!org_id) throw new Error('org_id manquant')

    const { data: membership } = await supabaseAdmin
      .from('org_members').select('role').eq('org_id', org_id).eq('user_id', caller.id).eq('status', 'active').maybeSingle()
    if (!membership || !['owner', 'manager'].includes(membership.role)) throw new Error('Non autorisé sur cette organisation')

    const { data: org, error: orgErr } = await supabaseAdmin.from('organizations').select('stripe_customer_id').eq('id', org_id).maybeSingle()
    if (orgErr) throw orgErr
    if (!org?.stripe_customer_id) throw new Error("Aucun abonnement Stripe actif pour cette organisation")

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: return_url || 'https://thepackclub.fr/espace-pro.html',
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
