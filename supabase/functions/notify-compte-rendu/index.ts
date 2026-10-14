import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = 'The Pack Club <reservations@thepackclub.fr>'

// Phase Pro 5 : notifie le client qu'un compte rendu (photo/duree/notes) a
// ete publie par le pro apres une prestation. Declenchee par un trigger
// Database Webhook sur comptes_rendus (meme mecanisme que notify-new-lieu/
// notify-reservation -- un trigger Postgres appelant supabase_functions.
// http_request, pose directement en base, jamais via une migration versionnee
// -- la cle service_role qu'il porte ne doit jamais entrer dans l'historique
// git, cf les 5 triggers existants du meme type).
async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) { console.log('RESEND_API_KEY not set, skipping email'); return }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  const body = await res.json()
  console.log('Resend response', res.status, JSON.stringify(body))
}

async function sendPush(token: string, title: string, body: string, data?: Record<string, unknown>) {
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: token, title, body, data, sound: 'default', badge: 1 }),
  })
}

Deno.serve(async (req) => {
  const payload = await req.json()
  const cr = payload.record
  if (!cr) return new Response('no record', { status: 200 })

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: lieu } = await sb.from('lieux').select('nom').eq('id', cr.lieu_id).maybeSingle()
  const lieuNom = lieu?.nom || 'votre prestataire'

  const { data: profil } = await sb.from('profils').select('push_token, prenom').eq('id', cr.user_id).maybeSingle()
  if (profil?.push_token) {
    await sendPush(
      profil.push_token, 'Compte rendu disponible',
      `${lieuNom} a ajouté un compte rendu pour votre dernier rendez-vous.`,
      { type: 'compte_rendu', reservationId: cr.reservation_id },
    )
  }
  const { data: authUser } = await sb.auth.admin.getUserById(cr.user_id)
  if (authUser?.user?.email) {
    await sendEmail(authUser.user.email, `Compte rendu — ${lieuNom}`, `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3D1A1A">
        <h2 style="color:#C4693A">Un compte rendu vous attend</h2>
        <p>Bonjour ${profil?.prenom || ''},</p>
        <p><strong>${lieuNom}</strong> vient d'ajouter un compte rendu pour votre dernier rendez-vous${cr.duree_minutes ? ` (${cr.duree_minutes} min)` : ''}.</p>
        ${cr.notes ? `<p style="background:#F7F0EC;border-radius:8px;padding:12px 16px">${cr.notes}</p>` : ''}
      </div>
    `)
  }

  return new Response(JSON.stringify({ sent: true }), { status: 200 })
})
