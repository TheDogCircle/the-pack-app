import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTrackedPush } from '../_shared/pushTracking.ts'

// Valider/refuser/annuler un evenement depuis admin/evenements.html. Client
// construit avec la cle anon + le JWT de l'admin appelant (jamais le service
// role) : la verification is_admin('moderator') et l'ecriture passent par ce
// meme JWT, donc auth.uid() resout correctement cote RLS et pour un eventuel
// trigger d'audit -- pas besoin de service role ici, la lecture des
// push_token passe par des policies deja ouvertes aux admins.
//
// Note sur les notifications de proximite : valider un evenement (valide
// false -> true) declenche deja, via le trigger DB existant
// on-event-validated -> edge function notify-new-event, une notif aux
// membres a proximite -- rien a refaire ici. Cette fonction ne notifie que
// l'organisateur (valider/refuser) et les inscrits (annuler), qui ne sont
// couverts par aucun mecanisme existant.

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const { event_id, action, motif } = await req.json()

    if (!event_id || !['valider', 'refuser', 'annuler'].includes(action)) {
      return new Response(JSON.stringify({ error: 'paramètres invalides' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if ((action === 'refuser' || action === 'annuler') && !(motif && String(motif).trim())) {
      return new Response(JSON.stringify({ error: 'motif requis' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: isModerator } = await sb.rpc('is_admin', { role_min: 'moderator' })
    if (!isModerator) {
      return new Response(JSON.stringify({ error: 'accès refusé' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }

    const { data: event, error: eFetch } = await sb.from('evenements')
      .select('id, titre, organisateur_id, date_heure, ville, adresse')
      .eq('id', event_id).single()
    if (eFetch || !event) {
      return new Response(JSON.stringify({ error: 'événement introuvable' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    let patch: Record<string, unknown>
    if (action === 'valider') {
      patch = { valide: true, refuse: false, refuse_motif: null, refuse_at: null, refuse_by: null, actif: true }
    } else if (action === 'refuser') {
      patch = { valide: false, refuse: true, refuse_motif: motif, refuse_at: new Date().toISOString() }
    } else {
      patch = { actif: false }
    }

    const { error: eUpdate } = await sb.from('evenements').update(patch).eq('id', event_id)
    if (eUpdate) {
      return new Response(JSON.stringify({ error: eUpdate.message }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    if (action === 'valider' || action === 'refuser') {
      const { data: organisateur } = await sb.from('profils').select('push_token').eq('id', event.organisateur_id).maybeSingle()
      if (organisateur?.push_token) {
        const title = action === 'valider' ? 'Événement validé !' : 'Événement refusé'
        const body = action === 'valider'
          ? `"${event.titre}" est maintenant publié.`
          : `"${event.titre}" a été refusé. Motif : ${motif}`
        await sendTrackedPush(sb, {
          type: action === 'valider' ? 'event_validated' : 'event_refused',
          targetId: event.id, title, body,
          recipients: [{ push_token: organisateur.push_token }],
          extraData: { eventId: event.id },
        })
      }
    } else {
      const { data: participations } = await sb.from('participations').select('user_id').eq('event_id', event_id)
      const recipientIds = new Set<string>((participations || []).map((p: any) => p.user_id))
      recipientIds.add(event.organisateur_id)
      const { data: profils } = await sb.from('profils').select('push_token').in('id', Array.from(recipientIds)).not('push_token', 'is', null)
      const recipients = (profils || []).map((p: any) => ({ push_token: p.push_token })).filter((r: any) => r.push_token)
      if (recipients.length > 0) {
        await sendTrackedPush(sb, {
          type: 'event_cancelled', targetId: event.id,
          title: 'Événement annulé',
          body: `"${event.titre}" a été annulé. Motif : ${motif}`,
          recipients,
          extraData: { eventId: event.id },
        })
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
