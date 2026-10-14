import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Phase Pro 6, point 4 : un pro Premium envoie une offre aux membres proches
// de son lieu. Reutilise campaign_audience_list() (deja construite pour les
// campagnes admin, revoke de 'authenticated' -- appelable uniquement via
// service role, cf migration 20260930332000) centree sur les coordonnees du
// lieu plutot que choisies a la main par un admin. Decision actee avec
// Marine : pas de file d'attente de validation admin cette phase (la
// "phase Admin 7" referencee dans la demande n'existe pas encore) -- le
// quota mensuel est le seul garde-fou.
async function sendBatch(messages: Record<string, unknown>[]) {
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100)
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(batch),
    }).catch((e) => console.error('sendBatch:', e.message))
  }
}

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

    const { lieu_id, title, body, rayon_km } = await req.json()
    if (!lieu_id || !title?.trim() || !body?.trim() || !rayon_km) throw new Error('Champs manquants')
    const rayon = Number(rayon_km)
    if (!(rayon > 0 && rayon <= 50)) throw new Error('Rayon invalide (entre 1 et 50 km)')

    const { data: lieu, error: lieuErr } = await supabaseAdmin
      .from('lieux').select('id, nom, manager_user_id, lat, lng').eq('id', lieu_id).maybeSingle()
    if (lieuErr) throw lieuErr
    if (!lieu) throw new Error('Lieu introuvable')
    if (lieu.lat == null || lieu.lng == null) throw new Error('Ce lieu n\'a pas de position géographique renseignée')

    const { data: place } = await supabaseAdmin.from('org_places').select('org_id').eq('lieu_id', lieu_id).eq('statut', 'approved').maybeSingle()
    if (!place?.org_id) throw new Error('Ce lieu n\'est rattaché à aucune organisation')

    let isAuthorized = lieu.manager_user_id === caller.id
    if (!isAuthorized) {
      const { data: membership } = await supabaseAdmin
        .from('org_members').select('role').eq('org_id', place.org_id).eq('user_id', caller.id).eq('status', 'active').maybeSingle()
      const roleRank: Record<string, number> = { owner: 3, manager: 2, staff: 1 }
      isAuthorized = !!membership && (roleRank[membership.role] ?? 0) >= 2
    }
    if (!isAuthorized) throw new Error('Réservé au propriétaire ou à un gestionnaire')

    const { data: hasFeature } = await supabaseAdmin.rpc('org_has_feature', { p_org_id: place.org_id, p_feature: 'notifications_ciblees' })
    if (!hasFeature) throw new Error('Cette fonctionnalité est incluse à partir du plan Premium')

    const { data: quotaSetting } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'notifications_ciblees_quota_mensuel').maybeSingle()
    const quota = Number(quotaSetting?.value ?? 4)
    const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0)
    const { count: sentThisMonth } = await supabaseAdmin
      .from('org_notification_requests').select('id', { count: 'exact', head: true })
      .eq('org_id', place.org_id).gte('created_at', debutMois.toISOString())
    if ((sentThisMonth ?? 0) >= quota) throw new Error(`Quota mensuel atteint (${quota} envois/mois)`)

    const { data: audience, error: audienceErr } = await supabaseAdmin.rpc('campaign_audience_list', {
      p_lat: lieu.lat, p_lng: lieu.lng, p_rayon_km: rayon,
    })
    if (audienceErr) throw audienceErr

    const messages = (audience || []).map((r: { token: string }) => ({
      to: r.token, title: title.trim(), body: body.trim(),
      data: { type: 'offre_locale', targetType: 'lieu', lieuId: lieu_id },
      sound: 'default',
    }))
    await sendBatch(messages)

    await supabaseAdmin.from('org_notification_requests').insert({
      org_id: place.org_id, lieu_id, title: title.trim(), body: body.trim(),
      rayon_km: rayon, recipients_count: messages.length, created_by: caller.id,
    })

    return new Response(JSON.stringify({ sent: true, recipients_count: messages.length, remaining_quota: quota - (sentThisMonth ?? 0) - 1 }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
