import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Notifie l'owner d'une organisation d'un evenement d'abonnement (paiement
// en echec, regularise, retrograde apres delai de grace, resilie). Appelee
// uniquement en interne -- par stripe-webhook (bearer service role) ou par
// le cron run_subscription_grace_check() (bearer cle anon, meme pattern que
// les autres cron de ce projet, ex. send-nps-surveys). Pas de verification
// admin_roles ici : meme posture que notify-reservation, qui se repose
// uniquement sur la verification JWT du gateway Supabase (deploiement par
// defaut), aucune des deux n'exposant de donnee sensible ni d'action
// destructrice au-dela de l'envoi d'un email.
const MESSAGES: Record<string, { subject: string; body: string }> = {
  payment_failed: {
    subject: 'Problème avec votre paiement The Pack Club',
    body: "Le paiement de votre abonnement a échoué. Vous avez <strong>7 jours</strong> pour régulariser votre moyen de paiement, sans quoi votre compte repassera automatiquement à l'offre Découverte (vos données restent intactes).",
  },
  payment_recovered: {
    subject: 'Paiement régularisé — merci !',
    body: 'Votre paiement a bien été pris en compte, votre abonnement continue normalement.',
  },
  downgraded: {
    subject: 'Votre offre est repassée à Découverte',
    body: "Le paiement n'a pas été régularisé dans le délai de 7 jours : votre compte est repassé à l'offre Découverte. Vos données sont conservées — vous pouvez reprendre un abonnement à tout moment depuis votre espace pro.",
  },
  canceled: {
    subject: 'Votre abonnement a été résilié',
    body: "Votre abonnement a été résilié et votre compte est repassé à l'offre Découverte. Vos données sont conservées.",
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { org_id, event } = await req.json()
    if (!org_id || !event) throw new Error('org_id et event requis')
    const message = MESSAGES[event]
    if (!message) throw new Error('event invalide')

    const { data: owner } = await supabaseAdmin
      .from('org_members').select('user_id').eq('org_id', org_id).eq('role', 'owner').eq('status', 'active').maybeSingle()
    if (!owner?.user_id) throw new Error('Propriétaire introuvable pour cette organisation')

    const { data: { user: target }, error: userErr } = await supabaseAdmin.auth.admin.getUserById(owner.user_id)
    if (userErr || !target?.email) throw new Error('Email introuvable pour ce propriétaire')

    const { data: org } = await supabaseAdmin.from('organizations').select('nom').eq('id', org_id).maybeSingle()

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) throw new Error('RESEND_API_KEY non configurée')

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'The Pack Club <contact@thepackclub.fr>',
        to: [target.email],
        subject: message.subject,
        html: `
          <div style="font-family:Georgia,serif;color:#3D1A1A;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="font-weight:500">${message.subject}</h2>
            <p>Bonjour,</p>
            <p>${message.body}</p>
            ${org?.nom ? `<p style="font-size:13px;color:#8A6B5A">Concerne : ${org.nom}</p>` : ''}
            <p><a href="https://thepackclub.fr/espace-pro.html" style="display:inline-block;background:#3D1A1A;color:#F5EFE0;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:8px">Voir mon abonnement</a></p>
            <p style="font-size:13px;color:#8A6B5A;margin-top:24px">The Pack Club</p>
          </div>
        `,
      }),
    })
    if (!emailRes.ok) {
      const errBody = await emailRes.text()
      throw new Error(`Envoi email échoué : ${errBody}`)
    }

    return new Response(JSON.stringify({ ok: true, to: target.email }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
