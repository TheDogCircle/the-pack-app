import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = 'The Pack Club <partenaires@thepackclub.fr>'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Phase Pro 7, point 1 : l'admin demande une precision sur une candidature
// (statut 'precision_demandee', pas de CHECK constraint sur
// candidatures_partenaires.statut -- confirme en base, rien a migrer pour
// cette valeur). Meme pattern que notify-marque-access (email Resend,
// reserve a un appelant admin).
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

    const { candidature_id, message } = await req.json()
    if (!candidature_id || !message?.trim()) throw new Error('candidature_id et message requis')

    const { data: candidature, error: candErr } = await supabaseAdmin
      .from('candidatures_partenaires').select('id, nom_marque, email, statut').eq('id', candidature_id).maybeSingle()
    if (candErr) throw candErr
    if (!candidature) throw new Error('Candidature introuvable')

    await supabaseAdmin.from('candidatures_partenaires')
      .update({ statut: 'precision_demandee', note_admin: message.trim() })
      .eq('id', candidature_id)

    if (RESEND_API_KEY && candidature.email) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: FROM_EMAIL, to: candidature.email,
          subject: `Votre candidature The Pack — une précision est nécessaire`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3D1A1A">
              <h2 style="color:#C4693A">Une précision est nécessaire</h2>
              <p>Bonjour,</p>
              <p>Merci pour votre candidature au nom de <strong>${candidature.nom_marque || 'votre marque'}</strong>. Avant de poursuivre l'examen, nous avons besoin d'une précision :</p>
              <p style="background:#F7F0EC;border-radius:8px;padding:12px 16px">${message.trim().replace(/</g, '&lt;')}</p>
              <p>Répondez simplement à cet email, ou re-soumettez votre candidature avec les informations demandées.</p>
            </div>
          `,
        }),
      }).catch((e) => console.error('resend:', e.message))
    } else {
      console.log('RESEND_API_KEY not set or candidature without email, skipping email')
    }

    return new Response(JSON.stringify({ sent: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
