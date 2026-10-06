import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import JSZip from 'https://esm.sh/jszip@3.10.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = 'The Pack Club <contact@thepackclub.fr>'

// Droit d'acces RGPD. Les photos/videos sont deja sur des URLs publiques
// permanentes (R2 cote mobile, Storage cote web) : pas d'objet prive a
// signer pour elles, on inclut juste l'URL existante. Seul le ZIP complet
// passe par une URL signee (bucket prive rgpd-exports), valable 7 jours.
// Rassemblement en service role (besoin de lire au-dela de ce que les RLS
// "own row" autorisent, ex. auth.users.last_sign_in_at via l'API admin) --
// mais isSelf/role admin verifies avant toute lecture.

function toCSV(rows: any[]): string {
  if (!rows || !rows.length) return ''
  const keySet = new Set<string>()
  rows.forEach(r => Object.keys(r || {}).forEach(k => keySet.add(k)))
  const keys = Array.from(keySet)
  const esc = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n')
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) { console.log('RESEND_API_KEY not set, skipping email'); return }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  console.log('Resend response', res.status, JSON.stringify(await res.json()))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Non autorisé')
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !caller) throw new Error('Token invalide')

    let body: any = {}
    try { body = await req.json() } catch (_) {}
    const targetUserId: string = body.userId || caller.id
    const isSelf = targetUserId === caller.id
    const requestSource: 'self' | 'admin' = isSelf ? 'self' : 'admin'

    if (!isSelf) {
      const { data: callerRole } = await admin.from('admin_roles').select('role').eq('user_id', caller.id).maybeSingle()
      if (!['moderator', 'super_admin'].includes(callerRole?.role ?? '')) throw new Error('Accès refusé')
    }

    if (requestSource === 'self') {
      const { data: recent } = await admin.from('data_export_requests')
        .select('created_at').eq('user_id', targetUserId).eq('status', 'completed')
        .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (recent) throw new Error('Tu as déjà demandé un export dans les dernières 24h. Réessaie plus tard.')
    }

    const { data: requestRow, error: eInsertReq } = await admin.from('data_export_requests')
      .insert({ user_id: targetUserId, requested_by: caller.id, source: requestSource, status: 'pending' })
      .select('id').single()
    if (eInsertReq) throw eInsertReq

    try {
      const [profilRes, chiensRes, favorisRes, evFavRes, avisRes, photosRes, videosRes,
        messagesRes, convMembersRes, reservationsRes, evOrgRes, participationsRes,
        photoLikesRes, followingRes, followersRes, baladesRes] = await Promise.all([
        admin.from('profils').select('*').eq('id', targetUserId).single(),
        admin.from('chiens').select('*').eq('user_id', targetUserId),
        admin.from('favoris').select('*').eq('user_id', targetUserId),
        admin.from('evenements_favoris').select('*').eq('user_id', targetUserId),
        admin.from('avis').select('*').eq('user_id', targetUserId),
        admin.from('photos').select('*').eq('user_id', targetUserId),
        admin.from('videos').select('*').eq('user_id', targetUserId),
        admin.from('messages').select('*').eq('user_id', targetUserId),
        admin.from('conversation_members').select('conversation_id, joined_at, conversations(nom, type)').eq('user_id', targetUserId),
        admin.from('reservations').select('*').eq('user_id', targetUserId),
        admin.from('evenements').select('*').eq('organisateur_id', targetUserId),
        admin.from('participations').select('*, evenements(titre, date_heure)').eq('user_id', targetUserId),
        admin.from('photo_likes').select('*').eq('user_id', targetUserId),
        admin.from('follows').select('*').eq('follower_id', targetUserId),
        admin.from('follows').select('*').eq('following_id', targetUserId),
        admin.from('balades').select('*').eq('user_id', targetUserId),
      ])

      const profil = profilRes.data
      const chiens = chiensRes.data || []
      const chienIds = chiens.map((c: any) => c.id)
      const { data: carnetEntries } = chienIds.length
        ? await admin.from('chien_carnet_entries').select('*').in('chien_id', chienIds)
        : { data: [] as any[] }

      const { data: authUserData } = await admin.auth.admin.getUserById(targetUserId)
      const authUser = authUserData?.user

      const conversations = (convMembersRes.data || []).map((m: any) => ({
        conversation_id: m.conversation_id, nom: m.conversations?.nom, type: m.conversations?.type, rejoint_le: m.joined_at,
      }))
      const evenementsInscriptions = (participationsRes.data || []).map((p: any) => ({
        ...p, evenement_titre: p.evenements?.titre, evenement_date: p.evenements?.date_heure,
      }))

      const data = {
        export_genere_le: new Date().toISOString(),
        profil,
        chiens,
        carnet_de_sante: carnetEntries || [],
        lieux_enregistres: favorisRes.data || [],
        evenements_favoris: evFavRes.data || [],
        avis: avisRes.data || [],
        photos: photosRes.data || [],
        videos: videosRes.data || [],
        messages_envoyes: messagesRes.data || [],
        conversations,
        reservations: reservationsRes.data || [],
        evenements_organises: evOrgRes.data || [],
        evenements_inscriptions: evenementsInscriptions,
        photos_aimees: photoLikesRes.data || [],
        abonnements_suivis: followingRes.data || [],
        abonnes: followersRes.data || [],
        balades: baladesRes.data || [],
        abonnement_payant: { note: "Aucun abonnement individuel payant n'existe sur notre plateforme à ce jour." },
        consentements: { note: "Aucun consentement explicite distinct n'est tracé pour les comptes utilisateur standard à ce jour." },
        connexion: {
          compte_cree_le: authUser?.created_at ?? null,
          derniere_connexion_le: authUser?.last_sign_in_at ?? null,
          note: "Supabase ne conserve pas d'historique de connexion détaillé au-delà de la dernière connexion.",
        },
      }

      const zip = new JSZip()
      zip.file('donnees.json', JSON.stringify(data, null, 2))
      zip.file('profil.csv', toCSV([profil]))
      zip.file('chiens.csv', toCSV(chiens))
      zip.file('carnet_de_sante.csv', toCSV(carnetEntries || []))
      zip.file('lieux_enregistres.csv', toCSV(favorisRes.data || []))
      zip.file('evenements_favoris.csv', toCSV(evFavRes.data || []))
      zip.file('avis.csv', toCSV(avisRes.data || []))
      zip.file('photos.csv', toCSV(photosRes.data || []))
      zip.file('videos.csv', toCSV(videosRes.data || []))
      zip.file('messages.csv', toCSV(messagesRes.data || []))
      zip.file('conversations.csv', toCSV(conversations))
      zip.file('reservations.csv', toCSV(reservationsRes.data || []))
      zip.file('evenements_organises.csv', toCSV(evOrgRes.data || []))
      zip.file('photos_aimees.csv', toCSV(photoLikesRes.data || []))
      zip.file('abonnements_suivis.csv', toCSV(followingRes.data || []))
      zip.file('abonnes.csv', toCSV(followersRes.data || []))
      zip.file('balades.csv', toCSV(baladesRes.data || []))
      zip.file('evenements_inscriptions.csv', toCSV(evenementsInscriptions))
      zip.file('README.txt', [
        'The Pack Club -- export de vos données personnelles',
        'Généré le ' + new Date().toLocaleDateString('fr-FR'),
        '',
        'Ce fichier contient donnees.json (export complet structuré) et un CSV',
        'lisible par catégorie (profil, chiens, carnet_de_sante, lieux_enregistres,',
        'avis, photos, videos, messages, conversations, reservations,',
        'evenements_organises, evenements_inscriptions, photos_aimees,',
        'abonnements_suivis, abonnes, balades).',
        '',
        "Abonnement payant : aucun abonnement individuel payant n'existe sur",
        "notre plateforme à ce jour (abonnements_suivis/abonnes ci-dessus",
        "concernent les comptes que vous suivez, pas un paiement).",
        '',
        "Consentements : aucun consentement explicite distinct n'est tracé pour",
        'les comptes utilisateur standard à ce jour.',
        '',
        "Historique de connexion : seule la date de dernière connexion est",
        "disponible (voir donnees.json), pas d'historique détaillé au-delà.",
        '',
        "Messages : seuls les messages que vous avez envoyés sont inclus, pas",
        "le contenu des messages reçus d'autres membres.",
      ].join('\n'))

      const zipBytes = await zip.generateAsync({ type: 'uint8array' })

      const path = `${targetUserId}/${Date.now()}.zip`
      const { error: eUpload } = await admin.storage.from('rgpd-exports').upload(path, zipBytes, { contentType: 'application/zip', upsert: false })
      if (eUpload) throw eUpload

      const expiresIn = 7 * 24 * 3600
      const { data: signed, error: eSign } = await admin.storage.from('rgpd-exports').createSignedUrl(path, expiresIn)
      if (eSign) throw eSign

      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
      await admin.from('data_export_requests').update({
        status: 'completed', storage_path: path, signed_url_expires_at: expiresAt, completed_at: new Date().toISOString(),
      }).eq('id', requestRow.id)

      const toEmail = authUser?.email
      if (toEmail && !toEmail.endsWith('@deleted.invalid')) {
        await sendEmail(toEmail, 'Votre export de données The Pack Club', `
          <p>Bonjour,</p>
          <p>Voici le lien pour télécharger l'export de vos données personnelles (valable 7 jours) :</p>
          <p><a href="${signed.signedUrl}">${signed.signedUrl}</a></p>
          <p>Si vous n'êtes pas à l'origine de cette demande, contactez-nous.</p>
        `)
      }

      if (requestSource === 'admin') {
        const sbCaller = createClient(
          Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } }
        )
        await sbCaller.rpc('log_admin_action', {
          p_action: 'export_data', p_entity_type: 'profil', p_entity_id: targetUserId,
          p_before: null, p_after: null, p_reason: 'Export RGPD généré sur demande reçue par email',
        })
      }

      return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    } catch (innerErr) {
      await admin.from('data_export_requests').update({ status: 'failed', error_message: (innerErr as Error).message }).eq('id', requestRow.id)
      throw innerErr
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
