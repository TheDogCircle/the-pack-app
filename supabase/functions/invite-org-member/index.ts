import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Invitation d'un membre d'equipe (Phase Pro 3, "Equipe & acces") -- reserve
// owner (meme seuil que l'onglet lui-meme cote espace-pro.html). L'insertion
// org_members passe par le client (RLS org_members_owner_insert deja en
// place, pas besoin de service role pour ca) -- cette fonction ne fait que
// l'email, avec la service role car auth.admin.getUserByEmail n'est pas
// accessible via une cle anon/authenticated normale.
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

    const { org_id, email, role } = await req.json()
    if (!org_id || !email || !role) throw new Error('Champs manquants')
    if (!['manager', 'staff'].includes(role)) throw new Error('Rôle invalide')

    const { data: membership } = await supabaseAdmin
      .from('org_members').select('role').eq('org_id', org_id).eq('user_id', caller.id).eq('status', 'active').maybeSingle()
    if (!membership || membership.role !== 'owner') throw new Error('Seul le propriétaire peut inviter un membre')

    const { data: org } = await supabaseAdmin.from('organizations').select('nom').eq('id', org_id).maybeSingle()

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (resendKey) {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'The Pack Club <contact@thepackclub.fr>',
          to: [email],
          subject: `Invitation à rejoindre ${org?.nom || 'une organisation'} sur The Pack`,
          html: `
            <div style="font-family:Georgia,serif;color:#3D1A1A;max-width:480px;margin:0 auto;padding:24px">
              <h2 style="font-weight:500">Vous êtes invité(e) à rejoindre ${org?.nom || 'une organisation'}</h2>
              <p>Bonjour,</p>
              <p>Vous avez été invité(e) à rejoindre l'équipe de <strong>${org?.nom || 'cette organisation'}</strong> sur The Pack Club, avec le rôle ${role === 'manager' ? 'gestionnaire' : 'employé'}.</p>
              <p>Connectez-vous (ou créez un compte) avec l'adresse <strong>${email}</strong> pour accéder à l'espace pro.</p>
              <p><a href="https://thepackclub.fr/pro-auth.html" style="display:inline-block;background:#3D1A1A;color:#F5EFE0;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:8px">Accéder à l'espace pro</a></p>
              <p style="font-size:13px;color:#8A6B5A;margin-top:24px">The Pack Club</p>
            </div>
          `,
        }),
      })
      if (!emailRes.ok) console.error('invite-org-member: envoi email echoue', await emailRes.text())
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
