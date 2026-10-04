import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Heures calmes en heure de Paris (toute l'app est francophone/France,
// pas de fuseau par utilisateur a disposition -- cf diagnostic Phase 7).
function isQuietHoursParis(): boolean {
  const hour = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return hour >= 22 || hour < 8
}

async function sendBatch(messages: Record<string, unknown>[]) {
  const tickets: any[] = []
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100)
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(batch),
    })
    const json = await res.json().catch(() => null)
    const batchTickets = Array.isArray(json?.data) ? json.data : []
    tickets.push(...batchTickets)
  }
  return tickets
}

function deepLinkData(type: string | null, value: string | null, extra: string | null = null): Record<string, unknown> {
  const data: Record<string, unknown> = { type: 'broadcast' }
  if (type === 'lieu') { data.targetType = 'lieu'; data.lieuId = value }
  else if (type === 'event') { data.targetType = 'event'; data.eventId = value }
  else if (type === 'profil') { data.targetType = 'profil'; data.userId = value }
  else if (type === 'carnet_sante') { data.targetType = 'carnet_sante' }
  else if (type === 'partenaire' || type === 'partenaires') {
    // deep_link_value porte le partenaire_id (connu qu'on soit parti de "une marque
    // precise" ou d'une offre choisie directement dans "offres du moment" -- cf admin
    // notifications-push.html) ; deep_link_extra porte la partenaire_posts.id si une
    // offre precise a ete choisie. Sans valeur du tout, on ouvre juste l'onglet general.
    if (value) { data.targetType = 'partenaire'; data.partenaireId = value; if (extra) data.postId = extra }
    else { data.targetType = 'partenaires' }
  }
  return data
}

// Plafond de 3 campagnes B2B/jour et par destinataire -- uniquement pour
// cet outil (les notifications produit existantes -- nouveau lieu, nouvel
// abonne, etc. -- ne sont pas concernees, decision explicite de Marine).
async function processCampaign(supabaseAdmin: any, campaignId: string) {
  const { data: campaign, error } = await supabaseAdmin.from('notification_campaigns').select('*').eq('id', campaignId).maybeSingle()
  if (error || !campaign) throw new Error('Campagne introuvable')
  if (campaign.status === 'envoyee') return { campaign_id: campaignId, skipped: 'déjà envoyée' }

  const { data: audience } = await supabaseAdmin.rpc('campaign_audience_list', {
    p_ville: campaign.target_ville,
    p_rayon_km: campaign.target_rayon_km,
    p_lat: campaign.target_lat,
    p_lng: campaign.target_lng,
    p_platform: campaign.target_platform,
    p_badge_fondatrice: campaign.target_badge_fondatrice,
  })

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recentSends } = await supabaseAdmin
    .from('notification_campaign_sends')
    .select('user_id')
    .eq('status', 'sent')
    .gte('created_at', yesterday)
  const sentTodayCount = new Map<string, number>()
  for (const r of recentSends || []) {
    sentTodayCount.set(r.user_id, (sentTodayCount.get(r.user_id) ?? 0) + 1)
  }

  const dataPayload = deepLinkData(campaign.deep_link_type, campaign.deep_link_value, campaign.deep_link_extra)
  // campaignId : permet au client de marquer sa propre ligne notification_campaign_sends
  // comme ouverte au tap (cf mark_campaign_notification_opened), pour que l'admin
  // puisse voir combien de destinataires ont reellement ouvert, pas juste recu l'envoi.
  dataPayload.campaignId = campaignId
  const messages: Record<string, unknown>[] = []
  const sendRows: { campaign_id: string; user_id: string; status: string; expo_ticket_id?: string | null }[] = []

  for (const recipient of audience || []) {
    if ((sentTodayCount.get(recipient.user_id) ?? 0) >= 3) {
      sendRows.push({ campaign_id: campaignId, user_id: recipient.user_id, status: 'skipped_cap' })
      continue
    }
    messages.push({ to: recipient.token, title: campaign.title, body: campaign.body, data: dataPayload, sound: 'default', badge: 1 })
    sendRows.push({ campaign_id: campaignId, user_id: recipient.user_id, status: 'sent' })
  }

  const tickets = messages.length ? await sendBatch(messages) : []
  let ticketIdx = 0
  for (const row of sendRows) {
    if (row.status === 'sent') {
      row.expo_ticket_id = tickets[ticketIdx]?.id ?? null
      ticketIdx++
    }
  }

  if (sendRows.length) await supabaseAdmin.from('notification_campaign_sends').insert(sendRows)

  const sentCount = sendRows.filter((r) => r.status === 'sent').length
  await supabaseAdmin.from('notification_campaigns').update({
    status: 'envoyee',
    sent_at: new Date().toISOString(),
    recipients_count: sentCount,
  }).eq('id', campaignId)

  return {
    campaign_id: campaignId,
    sent: sentCount,
    skipped_cap: sendRows.filter((r) => r.status === 'skipped_cap').length,
  }
}

// 'test' et 'send' sont tous deux reserves aux moderateurs+ -- 'test' envoie
// uniquement a TEST_PUSH_TOKEN (jamais a un vrai membre) mais sans cette
// garde, n'importe qui connaissant l'URL de la fonction (la cle anon est
// publique, deja presente cote client) pouvait spammer le telephone de
// Marine avec un contenu arbitraire sans passer par l'admin. Trouve en
// recette Phase 7.
async function requireModerator(supabaseAdmin: any, req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new Error('Non autorisé')
  const token = authHeader.replace('Bearer ', '')
  const { data: { user: caller }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !caller) throw new Error('Non autorisé')
  const { data: callerRole } = await supabaseAdmin.from('admin_roles').select('role').eq('user_id', caller.id).maybeSingle()
  if (!['moderator', 'super_admin'].includes(callerRole?.role ?? '')) throw new Error('Réservé aux modérateurs et plus')
  return { caller, authHeader }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const payload = await req.json()
    const mode = payload.mode as 'test' | 'send' | 'cron'

    if (mode === 'test') {
      await requireModerator(supabaseAdmin, req)

      // Envoi exclusivement au telephone de test (TEST_PUSH_TOKEN) -- jamais
      // a un vrai destinataire, meme si une campaign_id est fournie pour
      // pre-remplir le contenu. Consigne explicite de Marine.
      const testToken = Deno.env.get('TEST_PUSH_TOKEN')
      if (!testToken) throw new Error('TEST_PUSH_TOKEN non configuré côté serveur')

      let title = payload.title
      let body = payload.body
      let deepLinkType = payload.deep_link_type ?? null
      let deepLinkValue = payload.deep_link_value ?? null
      let deepLinkExtra = payload.deep_link_extra ?? null
      if (payload.campaign_id) {
        const { data: c } = await supabaseAdmin.from('notification_campaigns').select('*').eq('id', payload.campaign_id).maybeSingle()
        if (c) { title = c.title; body = c.body; deepLinkType = c.deep_link_type; deepLinkValue = c.deep_link_value; deepLinkExtra = c.deep_link_extra }
      }

      const tickets = await sendBatch([{
        to: testToken, title: title || '(test)', body: body || '',
        data: deepLinkData(deepLinkType, deepLinkValue, deepLinkExtra), sound: 'default', badge: 1,
      }])
      return new Response(JSON.stringify({ sent: true, tickets }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    if (mode === 'send') {
      const { authHeader } = await requireModerator(supabaseAdmin, req)

      if (isQuietHoursParis()) {
        throw new Error("Heures calmes en cours (22h-8h) — utilise \"Planifier\" pour un envoi différé plutôt qu'un envoi immédiat.")
      }

      const result = await processCampaign(supabaseAdmin, payload.campaign_id)

      // processCampaign ecrit le statut 'envoyee' via la service role (necessaire
      // pour le reste du traitement), donc le trigger generique trg_log_admin_action
      // ne logge rien ici : son check interne is_admin('viewer') lit auth.uid(),
      // toujours nul sous service role. On logge donc explicitement l'action avec
      // un client scope sur le JWT de l'appelant, meme pattern que
      // admin-refund-reservation. Trouve en recette Phase 7.
      const supabaseCaller = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      )
      await supabaseCaller.rpc('log_admin_action', {
        p_action: 'send_campaign', p_entity_type: 'notification_campaigns', p_entity_id: payload.campaign_id,
        p_before: null, p_after: { sent: result.sent, skipped_cap: result.skipped_cap },
        p_reason: null,
      })

      return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    if (mode === 'cron') {
      if (isQuietHoursParis()) {
        return new Response(JSON.stringify({ skipped: 'heures calmes, nouvelle tentative au prochain passage du cron' }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }
      const { data: due } = await supabaseAdmin
        .from('notification_campaigns')
        .select('id')
        .eq('status', 'planifiee')
        .lte('scheduled_at', new Date().toISOString())

      const results = []
      for (const c of due || []) {
        results.push(await processCampaign(supabaseAdmin, c.id))
      }
      return new Response(JSON.stringify({ processed: results.length, results }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    throw new Error('mode invalide')
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
