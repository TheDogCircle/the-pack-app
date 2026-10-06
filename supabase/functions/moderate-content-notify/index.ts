import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTrackedPush } from '../_shared/pushTracking.ts'

// Enveloppe moderate_content() (RPC SQL) pour y ajouter l'envoi de push a
// l'auteur et aux rapporteurs. Le client est construit avec la clef anon +
// le JWT de l'admin appelant (jamais le service role) : moderate_content()
// verifie elle-meme is_admin('moderator') via auth.uid(), et la lecture des
// push_token des destinataires passe par la policy publique sur profils.
const ACTION_MESSAGES: Record<string, { author: (motif: string | null) => { title: string; body: string } | null; reporter: { title: string; body: string } }> = {
  approuve: {
    author: () => ({ title: 'Signalement examiné', body: "Un de vos contenus a été signalé puis examiné : aucune action n'est nécessaire de votre part." }),
    reporter: { title: 'Signalement traité', body: 'Après vérification, le contenu signalé respecte nos conditions.' },
  },
  masque: {
    author: (motif) => ({ title: 'Contenu masqué', body: `Un de vos contenus a été masqué. Motif : ${motif}` }),
    reporter: { title: 'Signalement traité', body: 'Le contenu signalé a été masqué.' },
  },
  supprime: {
    author: (motif) => ({ title: 'Contenu supprimé', body: `Un de vos contenus a été supprimé. Motif : ${motif}` }),
    reporter: { title: 'Signalement traité', body: 'Le contenu signalé a été supprimé.' },
  },
  avertissement: {
    author: (motif) => ({ title: 'Avertissement', body: motif || 'Merci de respecter les règles de la communauté.' }),
    reporter: { title: 'Signalement traité', body: "Un avertissement a été adressé à l'auteur." },
  },
  suspension: {
    author: (motif) => ({ title: 'Compte suspendu', body: `Votre compte a été suspendu. Motif : ${motif}` }),
    reporter: { title: 'Signalement traité', body: "Le compte de l'auteur a été suspendu." },
  },
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const { content_type, content_id, action, motif } = await req.json()

    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data, error } = await sb.rpc('moderate_content', {
      p_content_type: content_type,
      p_content_id: content_id,
      p_action: action,
      p_motif: motif ?? null,
    })
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const authorId: string | null = data?.author_id ?? null
    const reporterIds: string[] = Array.isArray(data?.reporter_ids) ? data.reporter_ids : []
    const msgs = ACTION_MESSAGES[action]

    const recipientIds = new Set<string>()
    const authorMsg = authorId && msgs ? msgs.author(motif ?? null) : null
    if (authorId && authorMsg) recipientIds.add(authorId)
    for (const r of reporterIds) recipientIds.add(r)

    if (recipientIds.size > 0 && msgs) {
      const { data: profils } = await sb
        .from('profils')
        .select('id, push_token')
        .in('id', Array.from(recipientIds))
        .not('push_token', 'is', null)
      const byId = new Map((profils ?? []).map((p: any) => [p.id, p.push_token as string]))

      if (authorId && authorMsg && byId.has(authorId)) {
        await sendTrackedPush(sb, {
          type: 'moderation_action',
          targetId: authorId,
          title: authorMsg.title,
          body: authorMsg.body,
          recipients: [{ push_token: byId.get(authorId)! }],
          extraData: { contentType: content_type, contentId: content_id, action },
        })
      }

      const reporterTokens = reporterIds
        .filter((id) => id !== authorId && byId.has(id))
        .map((id) => ({ push_token: byId.get(id)! }))
      if (reporterTokens.length > 0) {
        await sendTrackedPush(sb, {
          type: 'moderation_report_resolved',
          title: msgs.reporter.title,
          body: msgs.reporter.body,
          recipients: reporterTokens,
          extraData: { contentType: content_type, contentId: content_id, action },
        })
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
