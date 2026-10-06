import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = 'The Pack Club <reservations@thepackclub.fr>'

// Memes helpers que notify-reservation (declenchee a la creation) -- ici on
// notifie sur l'annulation, toujours les deux parties (client + pro), peu
// importe laquelle des deux a declenche l'annulation.
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' })

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

    const { reservation_id } = await req.json()
    if (!reservation_id) throw new Error('reservation_id manquant')

    const { data: resa, error: resaErr } = await supabaseAdmin
      .from('reservations')
      .select('id, lieu_id, user_id, prestation_id, date, heure_debut, heure_fin, statut, statut_paiement, montant_ht, client_prenom, client_tel, stripe_payment_intent_id, lieux(manager_user_id, nom, ville)')
      .eq('id', reservation_id)
      .maybeSingle()
    if (resaErr) throw resaErr
    if (!resa) throw new Error('Réservation introuvable')

    const managerUserId = (resa as any).lieux?.manager_user_id
    const isClient = resa.user_id === caller.id
    const isPro = !!managerUserId && managerUserId === caller.id
    if (!isClient && !isPro) throw new Error('Non autorisé sur cette réservation')

    // Notifie push + email les deux parties (client et pro) qu'une reservation
    // vient d'etre annulee -- appelee juste avant chaque `return` ci-dessous,
    // une fois le statut vraiment mis a jour en base.
    async function notifyCancellation(montantRembourse: number | null) {
      const lieu = (resa as any).lieux
      const lieuNom = lieu?.nom || 'l\'établissement'
      const lieuVille = lieu?.ville || ''
      const { data: prest } = resa.prestation_id
        ? await supabaseAdmin.from('prestations').select('nom').eq('id', resa.prestation_id).maybeSingle()
        : { data: null as { nom: string } | null }
      const prestNom = prest?.nom || 'Prestation'
      const dateStr = new Date(resa.date + 'T' + resa.heure_debut).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
      const heureStr = `${resa.heure_debut?.slice(0, 5)} – ${resa.heure_fin?.slice(0, 5)}`
      const remboursementLigne = montantRembourse
        ? `<tr><td style="padding:8px 0;color:#8A6B5A">Montant remboursé</td><td style="padding:8px 0;font-weight:500">${montantRembourse.toFixed(2)} €</td></tr>`
        : ''

      if (resa.user_id) {
        const { data: clientProfil } = await supabaseAdmin.from('profils')
          .select('push_token, prenom').eq('id', resa.user_id).maybeSingle()
        if (clientProfil?.push_token) {
          await sendPush(
            clientProfil.push_token,
            'Rendez-vous annulé',
            `Votre RDV chez ${lieuNom} le ${dateStr} à ${resa.heure_debut?.slice(0, 5)} a été annulé.${montantRembourse ? ` ${montantRembourse.toFixed(2)} € remboursés.` : ''}`,
            { type: 'reservation', reservationId: resa.id },
          )
        }
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(resa.user_id)
        const clientEmail = authUser?.user?.email
        if (clientEmail) {
          await sendEmail(clientEmail, `Rendez-vous annulé — ${lieuNom}`, `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3D1A1A">
              <h2 style="color:#C4693A">Votre rendez-vous a été annulé</h2>
              <p>Bonjour ${clientProfil?.prenom || resa.client_prenom || ''},</p>
              <p>Votre rendez-vous chez <strong>${lieuNom}</strong>${lieuVille ? ` (${lieuVille})` : ''} a été annulé.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
                <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8A6B5A">Prestation</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:500">${prestNom}</td></tr>
                <tr><td style="padding:8px 0;${montantRembourse ? 'border-bottom:1px solid #eee;' : ''}color:#8A6B5A">Date</td><td style="padding:8px 0;${montantRembourse ? 'border-bottom:1px solid #eee;' : ''}font-weight:500">${dateStr} · ${heureStr}</td></tr>
                ${remboursementLigne}
              </table>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
              <p style="font-size:12px;color:#aaa">The Pack Club · La carte dog-friendly de France</p>
            </div>
          `)
        }
      }

      if (managerUserId) {
        const { data: proProfil } = await supabaseAdmin.from('profils')
          .select('push_token').eq('id', managerUserId).maybeSingle()
        if (proProfil?.push_token) {
          await sendPush(
            proProfil.push_token,
            'Rendez-vous annulé',
            `Le RDV de ${resa.client_prenom || 'un client'} pour ${prestNom} le ${dateStr} a été annulé.`,
            { type: 'new_reservation', reservationId: resa.id },
          )
        }
        const { data: proAuth } = await supabaseAdmin.auth.admin.getUserById(managerUserId)
        const proEmail = proAuth?.user?.email
        if (proEmail) {
          await sendEmail(proEmail, `Rendez-vous annulé — ${resa.client_prenom || 'Client'}`, `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3D1A1A">
              <h2 style="color:#C4693A">Une réservation a été annulée</h2>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
                <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8A6B5A">Client</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:500">${resa.client_prenom || '—'}${resa.client_tel ? ' · ' + resa.client_tel : ''}</td></tr>
                <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8A6B5A">Prestation</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:500">${prestNom}</td></tr>
                <tr><td style="padding:8px 0;color:#8A6B5A">Date</td><td style="padding:8px 0;font-weight:500">${dateStr} · ${heureStr}</td></tr>
              </table>
              <a href="https://thepacklameute.fr/espace-pro.html" style="display:inline-block;background:#C4693A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px">Voir mes réservations →</a>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
              <p style="font-size:12px;color:#aaa">The Pack Club · Espace Pro</p>
            </div>
          `)
        }
      }
    }

    if (resa.statut === 'annulee' || resa.statut === 'terminee') {
      throw new Error('Cette réservation ne peut plus être annulée')
    }

    // Reservation non payee (flux web gratuit historique) : simple annulation, pas de Stripe.
    if (!resa.stripe_payment_intent_id || resa.statut_paiement === 'non_requis') {
      await supabaseAdmin.from('reservations').update({ statut: 'annulee' }).eq('id', reservation_id)
      await notifyCancellation(null)
      return new Response(JSON.stringify({ cancelled: true, refunded: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Demande pas encore confirmee par le prestataire : la carte est seulement
    // autorisee (capture_method: 'manual'), jamais debitee -- on annule
    // l'autorisation plutot que de rembourser (rien n'a ete preleve).
    if (resa.statut_paiement === 'en_attente') {
      await stripe.paymentIntents.cancel(resa.stripe_payment_intent_id)
      await supabaseAdmin.from('reservations').update({ statut: 'annulee', statut_paiement: 'echoue' }).eq('id', reservation_id)
      await notifyCancellation(null)
      return new Response(JSON.stringify({ cancelled: true, refunded: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (resa.statut_paiement !== 'paye') {
      throw new Error('Le paiement de cette réservation n\'est pas encore confirmé')
    }

    // Le pro annulant rembourse toujours a 100% et ne garde pas sa commission.
    // Le client beneficie de 100% si annulation >=48h avant le RDV, 50% entre
    // 24h et 48h, et 0% dans les dernieres 24h.
    // La date/heure du RDV n'a pas de fuseau explicite en base : on la traite
    // en UTC, precision suffisante pour un seuil exprime en heures pleines.
    let refundPercent = 1
    if (isClient) {
      const rdvDate = new Date(`${resa.date}T${resa.heure_debut}Z`)
      const hoursUntil = (rdvDate.getTime() - Date.now()) / 3_600_000
      refundPercent = hoursUntil >= 48 ? 1 : hoursUntil >= 24 ? 0.5 : 0
    }

    const totalCents = Math.round(Number(resa.montant_ht) * 100)
    const refundAmountCents = Math.round(totalCents * refundPercent)

    // Stripe refuse un remboursement de montant nul (annulation client <24h) :
    // on annule simplement la reservation sans toucher au paiement.
    if (refundAmountCents === 0) {
      await supabaseAdmin
        .from('reservations')
        .update({ statut: 'annulee', montant_rembourse: 0 })
        .eq('id', reservation_id)
      await notifyCancellation(0)

      return new Response(JSON.stringify({
        cancelled: true, refunded: false, montant_rembourse: 0, refund_percent: 0,
      }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // refund_application_fee : Stripe rembourse automatiquement une part de la
    // commission proportionnelle au montant rembourse — jamais la commission
    // sur la part effectivement conservee par le prestataire.
    // reverse_transfer : obligatoire des lors que refund_application_fee est utilise
    // sur une charge avec transfer_data.destination (paiement Connect) — reprend
    // proportionnellement la part deja versee au prestataire.
    const refund = await stripe.refunds.create({
      payment_intent: resa.stripe_payment_intent_id,
      amount: refundAmountCents,
      refund_application_fee: true,
      reverse_transfer: true,
    })

    const montantRembourse = refundAmountCents / 100
    await supabaseAdmin
      .from('reservations')
      .update({
        statut: 'annulee',
        statut_paiement: 'rembourse',
        montant_rembourse: montantRembourse,
      })
      .eq('id', reservation_id)
    await notifyCancellation(montantRembourse)

    return new Response(JSON.stringify({
      cancelled: true,
      refunded: true,
      refund_id: refund.id,
      montant_rembourse: montantRembourse,
      refund_percent: refundPercent,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
