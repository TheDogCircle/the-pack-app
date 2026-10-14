import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = 'The Pack Club <partenaires@thepackclub.fr>'

// Phase Pro 7, point 5 : relance une marque n'ayant soumis aucune
// declaration de ventes pour le mois precedent. Appelee par le cron
// generate-monthly-commission-invoices pour chaque organisation marque
// concernee -- jamais directement exposee (pas de check admin_roles,
// meme contrainte que notify-reservation/notify-subscription-event,
// appelees uniquement par un cron/webhook de confiance).
Deno.serve(async (req) => {
  try {
    const { org_id, periode_label } = await req.json()
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: owners } = await supabaseAdmin
      .from('org_members').select('user_id').eq('org_id', org_id).eq('status', 'active').in('role', ['owner', 'manager'])
    const { data: org } = await supabaseAdmin.from('organizations').select('nom').eq('id', org_id).maybeSingle()

    if (!RESEND_API_KEY) { console.log('RESEND_API_KEY not set, skipping email'); return new Response('ok', { status: 200 }) }

    for (const owner of owners || []) {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(owner.user_id)
      const email = authUser?.user?.email
      if (!email) continue
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: FROM_EMAIL, to: email,
          subject: `Déclaration de ventes manquante — ${periode_label}`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3D1A1A">
              <h2 style="color:#C4693A">Déclaration de ventes en attente</h2>
              <p>Bonjour,</p>
              <p>Nous n'avons pas encore reçu la déclaration de ventes de <strong>${org?.nom || 'votre marque'}</strong> pour ${periode_label}.</p>
              <p>Merci de la soumettre depuis votre espace pro, rubrique "Ventes & commissions", dès que possible.</p>
            </div>
          `,
        }),
      }).catch((e) => console.error('resend:', e.message))
    }

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error('notify-declaration-manquante:', err.message)
    return new Response('error', { status: 400 })
  }
})
