import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateAndStoreInvoice } from '../_shared/commissionInvoicePdf.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Phase Pro 7, point 5 : genere a la demande (admin) la facture de
// commission d'une marque pour une periode donnee -- meme logique que le
// cron mensuel (generate-monthly-commission-invoices), partagee via
// _shared/commissionInvoicePdf.ts.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
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
    const { data: callerRole } = await supabaseAdmin.from('admin_roles').select('role').eq('user_id', caller.id).maybeSingle()
    if (!['support', 'moderator', 'super_admin'].includes(callerRole?.role)) throw new Error('Réservé aux admins')

    const { org_id, periode } = await req.json()
    if (!org_id || !periode) throw new Error('org_id et periode requis (YYYY-MM)')

    const result = await generateAndStoreInvoice(supabaseAdmin, org_id, periode)
    if (!result) {
      return new Response(JSON.stringify({ error: 'Aucune vente attribuée (brand_sale) pour cette période' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ generated: true, ...result }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
