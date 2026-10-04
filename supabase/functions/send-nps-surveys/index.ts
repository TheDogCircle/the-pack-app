import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Declenche quotidiennement par pg_cron (cf migration 20260930310000).
// 3 cohortes : onboarding_14j (utilisateurs, 14j apres inscription),
// onboarding_pro_30j (pros, 30j apres le debut de l'abonnement),
// recurrent_3mois (tout le monde deja promptE une fois, tous les 90j depuis
// le dernier prompt, qu'il y ait eu reponse ou non).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  async function sendPush(pushToken: string, contexte: string) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: pushToken,
        title: 'Un avis rapide ?',
        body: 'Quelle note donnerais-tu à The Pack ? Ça prend 10 secondes.',
        data: { type: 'nps_prompt', contexte },
        sound: 'default',
        badge: 1,
      }),
    })
  }

  let totalSent = 0

  try {
    // 1) Onboarding 14j (utilisateurs)
    const { data: alreadySent14j } = await supabaseAdmin.from('nps_prompts_sent').select('user_id').eq('contexte', 'onboarding_14j').not('user_id', 'is', null)
    const excluded14j = new Set((alreadySent14j || []).map(r => r.user_id))
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString()
    const { data: newUsers } = await supabaseAdmin.from('profils').select('id, push_token').lte('created_at', fourteenDaysAgo).not('push_token', 'is', null)
    for (const u of newUsers || []) {
      if (excluded14j.has(u.id)) continue
      await supabaseAdmin.from('nps_prompts_sent').insert({ user_id: u.id, contexte: 'onboarding_14j' })
      await sendPush(u.push_token, 'onboarding_14j')
      totalSent++
    }

    // 2) Onboarding 30j (pros -- lieux et partenaires)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
    for (const table of ['lieux', 'partenaires'] as const) {
      const { data: alreadySent30j } = await supabaseAdmin.from('nps_prompts_sent').select('pro_account_id').eq('contexte', 'onboarding_pro_30j').eq('pro_account_type', table)
      const excluded30j = new Set((alreadySent30j || []).map(r => r.pro_account_id))
      const { data: eligiblePros } = await supabaseAdmin
        .from(table).select('id, manager_user_id').lte('subscription_started_at', thirtyDaysAgo).not('manager_user_id', 'is', null)
      for (const pro of eligiblePros || []) {
        if (excluded30j.has(pro.id)) continue
        const { data: profil } = await supabaseAdmin.from('profils').select('push_token').eq('id', pro.manager_user_id).maybeSingle()
        await supabaseAdmin.from('nps_prompts_sent').insert({ pro_account_type: table, pro_account_id: pro.id, contexte: 'onboarding_pro_30j' })
        if (profil?.push_token) { await sendPush(profil.push_token, 'onboarding_pro_30j'); totalSent++ }
      }
    }

    // 3) Recurrent (tous les 90j depuis le dernier prompt, utilisateurs + pros)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const { data: allPrompts } = await supabaseAdmin
      .from('nps_prompts_sent').select('user_id, pro_account_type, pro_account_id, sent_at').order('sent_at', { ascending: false })

    const latestByIdentity = new Map<string, { user_id: string | null; pro_account_type: string | null; pro_account_id: string | null; sent_at: string }>()
    for (const p of allPrompts || []) {
      const key = p.user_id ? `u:${p.user_id}` : `p:${p.pro_account_type}:${p.pro_account_id}`
      if (!latestByIdentity.has(key)) latestByIdentity.set(key, p)
    }

    for (const [, latest] of latestByIdentity) {
      if (latest.sent_at > ninetyDaysAgo) continue
      if (latest.user_id) {
        const { data: profil } = await supabaseAdmin.from('profils').select('push_token').eq('id', latest.user_id).maybeSingle()
        await supabaseAdmin.from('nps_prompts_sent').insert({ user_id: latest.user_id, contexte: 'recurrent_3mois' })
        if (profil?.push_token) { await sendPush(profil.push_token, 'recurrent_3mois'); totalSent++ }
      } else if (latest.pro_account_type && latest.pro_account_id) {
        const { data: pro } = await supabaseAdmin.from(latest.pro_account_type).select('manager_user_id').eq('id', latest.pro_account_id).maybeSingle()
        await supabaseAdmin.from('nps_prompts_sent').insert({ pro_account_type: latest.pro_account_type, pro_account_id: latest.pro_account_id, contexte: 'recurrent_3mois' })
        if (pro?.manager_user_id) {
          const { data: profil } = await supabaseAdmin.from('profils').select('push_token').eq('id', pro.manager_user_id).maybeSingle()
          if (profil?.push_token) { await sendPush(profil.push_token, 'recurrent_3mois'); totalSent++ }
        }
      }
    }

    return new Response(JSON.stringify({ sent: totalSent }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
