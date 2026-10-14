import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkConges } from '../_shared/offerPricing.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = 'The Pack Club <reservations@thepackclub.fr>'

// Phase Pro 5 : deplace une reservation (meme duree, nouvelle date/heure de
// debut) -- la duree n'est jamais recalculee ici, seule la variante de prix
// deja figee (offer_price) la determine. S'appuie sur la contrainte
// d'exclusion Postgres (reservations_no_double_booking) comme filet de
// securite dur contre un chevauchement -- un conflit remonte en 23P01, traduit
// en message clair, plutot que revalider tout le moteur de regles de
// reservation ici (delai minimum, tampon : deja verifies a la creation,
// deplacer un RDV reste une action du pro/client sur un RDV existant, pas
// une nouvelle reservation).
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

    const { reservation_id, date, heure_debut } = await req.json()
    if (!reservation_id || !date || !heure_debut) throw new Error('Champs manquants')

    const { data: resa, error: resaErr } = await supabaseAdmin
      .from('reservations')
      .select('id, lieu_id, user_id, prestation_id, date, heure_debut, heure_fin, statut, client_prenom, client_tel, lieux(manager_user_id, nom, ville)')
      .eq('id', reservation_id)
      .maybeSingle()
    if (resaErr) throw resaErr
    if (!resa) throw new Error('Réservation introuvable')

    const managerUserId = (resa as any).lieux?.manager_user_id
    const isClient = resa.user_id === caller.id
    // 'staff' minimum, pas 'manager' -- Agenda & reservations est documente
    // comme accessible "staff compris" depuis la Phase Pro 3, et deplacer un
    // RDV est une action de base de cet ecran (meme recette que
    // reservations_org_write / comptes_rendus_pro_write).
    let isPro = !!managerUserId && managerUserId === caller.id
    if (!isPro) {
      const { data: place } = await supabaseAdmin.from('org_places').select('org_id').eq('lieu_id', resa.lieu_id).eq('statut', 'approved').maybeSingle()
      if (place?.org_id) {
        const { data: membership } = await supabaseAdmin
          .from('org_members').select('role').eq('org_id', place.org_id).eq('user_id', caller.id).eq('status', 'active').maybeSingle()
        const roleRank: Record<string, number> = { owner: 3, manager: 2, staff: 1 }
        isPro = !!membership && (roleRank[membership.role] ?? 0) >= 1
      }
    }
    if (!isClient && !isPro) throw new Error('Non autorisé sur cette réservation')
    if (resa.statut !== 'en_attente' && resa.statut !== 'confirmee') throw new Error('Cette réservation ne peut plus être déplacée')

    await checkConges(supabaseAdmin, resa.lieu_id, date)

    const [h, m, s] = resa.heure_debut.split(':').map(Number)
    const [h2, m2, s2] = resa.heure_fin.split(':').map(Number)
    const dureeMinutes = (h2 * 60 + m2) - (h * 60 + m)
    const [nh, nm] = heure_debut.split(':').map(Number)
    const totalFin = nh * 60 + nm + dureeMinutes
    const heure_fin = `${String(Math.floor(totalFin / 60) % 24).padStart(2, '0')}:${String(totalFin % 60).padStart(2, '0')}:${String(s2 || s || 0).padStart(2, '0')}`

    const ancienneDate = resa.date
    const ancienHeureDebut = resa.heure_debut

    const { error: updErr } = await supabaseAdmin
      .from('reservations')
      .update({ date, heure_debut, heure_fin })
      .eq('id', reservation_id)
    if (updErr) {
      if (updErr.code === '23P01') throw new Error('Ce créneau est déjà pris')
      throw updErr
    }

    // Notifie les deux parties -- meme pattern que cancel-reservation (deux
    // destinataires, peu importe qui a initie le changement).
    const { data: prest } = resa.prestation_id
      ? await supabaseAdmin.from('prestations').select('nom').eq('id', resa.prestation_id).maybeSingle()
      : { data: null as { nom: string } | null }
    const prestNom = prest?.nom || 'Prestation'
    const lieuNom = (resa as any).lieux?.nom || 'l\'établissement'
    const formatDate = (d: string, hh: string) => new Date(d + 'T' + hh).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    const ancienneDateStr = formatDate(ancienneDate, ancienHeureDebut)
    const nouvelleDateStr = formatDate(date, heure_debut)

    if (resa.user_id) {
      const { data: clientProfil } = await supabaseAdmin.from('profils').select('push_token, prenom').eq('id', resa.user_id).maybeSingle()
      if (clientProfil?.push_token) {
        await sendPush(
          clientProfil.push_token, 'Rendez-vous déplacé',
          `Votre RDV chez ${lieuNom} du ${ancienneDateStr} a été déplacé au ${nouvelleDateStr} à ${heure_debut.slice(0, 5)}.`,
          { type: 'reservation', reservationId: resa.id },
        )
      }
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(resa.user_id)
      if (authUser?.user?.email) {
        await sendEmail(authUser.user.email, `Rendez-vous déplacé — ${lieuNom}`, `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3D1A1A">
            <h2 style="color:#C4693A">Votre rendez-vous a changé d'horaire</h2>
            <p>Bonjour ${clientProfil?.prenom || resa.client_prenom || ''},</p>
            <p>Votre rendez-vous chez <strong>${lieuNom}</strong> pour ${prestNom} a été déplacé.</p>
            <p>Nouvelle date : <strong>${nouvelleDateStr} à ${heure_debut.slice(0, 5)}</strong> (au lieu du ${ancienneDateStr} à ${ancienHeureDebut.slice(0, 5)}).</p>
          </div>
        `)
      }
    }
    if (managerUserId) {
      const { data: proProfil } = await supabaseAdmin.from('profils').select('push_token').eq('id', managerUserId).maybeSingle()
      if (proProfil?.push_token) {
        await sendPush(
          proProfil.push_token, 'Rendez-vous déplacé',
          `Le RDV de ${resa.client_prenom || 'un client'} a été déplacé au ${nouvelleDateStr} à ${heure_debut.slice(0, 5)}.`,
          { type: 'new_reservation', reservationId: resa.id },
        )
      }
    }

    return new Response(JSON.stringify({ rescheduled: true, date, heure_debut, heure_fin }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
