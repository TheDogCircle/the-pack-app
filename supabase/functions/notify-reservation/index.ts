import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'The Pack Club <reservations@thepackclub.fr>';

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) { console.log('RESEND_API_KEY not set, skipping email'); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  const body = await res.json();
  console.log('Resend response', res.status, JSON.stringify(body));
}

async function sendPush(token: string, title: string, body: string, data?: Record<string, unknown>) {
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: token, title, body, data, sound: 'default', badge: 1 }),
  });
}

serve(async (req) => {
  const payload = await req.json();
  const resa = payload.record;
  if (!resa) return new Response('no record', { status: 200 });

  // Reservation payante (app) pas encore payee : on ne notifie qu'une fois le
  // paiement confirme (appel explicite depuis stripe-webhook), pas a l'insertion
  // provisoire faite par create-payment-intent.
  if (resa.statut_paiement === 'en_attente' || resa.statut_paiement === 'echoue') {
    return new Response(JSON.stringify({ skipped: true }), { status: 200 });
  }
  const isPaidBooking = resa.statut_paiement === 'paye';

  console.log('notify-reservation called, resa.id:', resa?.id, 'user_id:', resa?.user_id);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Fetch lieu + manager info
  const { data: lieu } = await sb.from('lieux')
    .select('nom, ville, manager_user_id')
    .eq('id', resa.lieu_id)
    .single();

  // Fetch prestation name
  const { data: prest } = resa.prestation_id
    ? await sb.from('prestations').select('nom,duree,prix').eq('id', resa.prestation_id).single()
    : { data: null };

  const dateStr = new Date(resa.date + 'T' + resa.heure_debut).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const lieuNom = lieu?.nom || 'l\'établissement';
  const lieuVille = lieu?.ville || '';
  const prestNom = prest?.nom || 'Prestation';

  // ── 1. Notification push au CLIENT (si user_id + push_token)
  if (resa.user_id) {
    const { data: clientProfil } = await sb.from('profils')
      .select('push_token, prenom')
      .eq('id', resa.user_id)
      .maybeSingle();
    if (clientProfil?.push_token) {
      await sendPush(
        clientProfil.push_token,
        isPaidBooking ? '✅ Réservation confirmée' : '📅 Demande de RDV envoyée',
        isPaidBooking
          ? `Votre RDV chez ${lieuNom} le ${dateStr} à ${resa.heure_debut.slice(0,5)} est confirmé et payé.`
          : `Votre demande chez ${lieuNom} le ${dateStr} à ${resa.heure_debut.slice(0,5)} a bien été reçue.`,
        { type: 'reservation', reservationId: resa.id },
      );
    }

    // Email de confirmation au client
    const { data: authUser, error: authErr } = await sb.auth.admin.getUserById(resa.user_id);
    const clientEmail = authUser?.user?.email;
    console.log('client email:', clientEmail, 'authErr:', authErr?.message);
    if (clientEmail) {
      await sendEmail(clientEmail, isPaidBooking ? `Réservation confirmée — ${lieuNom}` : `Demande de RDV — ${lieuNom}`, `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3D1A1A">
          <h2 style="color:#C4693A">${isPaidBooking ? 'Votre rendez-vous est confirmé' : 'Votre demande de rendez-vous'}</h2>
          <p>Bonjour ${clientProfil?.prenom || resa.client_prenom || ''},</p>
          <p>${isPaidBooking
            ? `Votre rendez-vous chez <strong>${lieuNom}</strong>${lieuVille ? ` (${lieuVille})` : ''} est confirmé et réglé.`
            : `Votre demande de rendez-vous a bien été envoyée à <strong>${lieuNom}</strong>${lieuVille ? ` (${lieuVille})` : ''}.`}</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
            <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8A6B5A">Prestation</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:500">${prestNom}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8A6B5A">Date</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:500">${dateStr}</td></tr>
            <tr><td style="padding:8px 0;${isPaidBooking ? 'border-bottom:1px solid #eee;' : ''}color:#8A6B5A">Heure</td><td style="padding:8px 0;${isPaidBooking ? 'border-bottom:1px solid #eee;' : ''}font-weight:500">${resa.heure_debut.slice(0,5)} – ${resa.heure_fin.slice(0,5)}</td></tr>
            ${isPaidBooking ? `<tr><td style="padding:8px 0;color:#8A6B5A">Montant réglé</td><td style="padding:8px 0;font-weight:500">${Number(resa.montant_ht || 0).toFixed(2)} €</td></tr>` : ''}
          </table>
          <p style="color:#8A6B5A;font-size:13px">${isPaidBooking ? "À bientôt !" : "L'établissement va confirmer votre rendez-vous et vous contactera directement."}</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
          <p style="font-size:12px;color:#aaa">The Pack Club · La carte dog-friendly de France</p>
        </div>
      `);
    }
  }

  // ── 2. Notification push + email au PRO (manager du lieu)
  if (lieu?.manager_user_id) {
    const { data: proProfil } = await sb.from('profils')
      .select('push_token')
      .eq('id', lieu.manager_user_id)
      .maybeSingle();
    if (proProfil?.push_token) {
      await sendPush(
        proProfil.push_token,
        isPaidBooking ? '💶 Nouveau RDV payé !' : '📅 Nouveau rendez-vous !',
        isPaidBooking
          ? `${resa.client_prenom || 'Un client'} a réservé et payé ${prestNom} le ${dateStr}.`
          : `${resa.client_prenom || 'Un client'} demande un RDV pour ${prestNom} le ${dateStr}.`,
        { type: 'new_reservation', reservationId: resa.id },
      );
    }

    const { data: proAuth } = await sb.auth.admin.getUserById(lieu.manager_user_id);
    const proEmail = proAuth?.user?.email;
    if (proEmail) {
      await sendEmail(proEmail, isPaidBooking ? `Nouveau RDV payé — ${resa.client_prenom || 'Client'}` : `Nouveau RDV — ${resa.client_prenom || 'Client'}`, `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#3D1A1A">
          <h2 style="color:#C4693A">${isPaidBooking ? 'Nouvelle réservation payée' : 'Nouvelle demande de rendez-vous'}</h2>
          <p>${isPaidBooking ? 'Un client a réservé et réglé un rendez-vous' : 'Un client souhaite prendre rendez-vous'} chez <strong>${lieuNom}</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
            <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8A6B5A">Client</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:500">${resa.client_prenom || '—'}${resa.client_tel ? ' · ' + resa.client_tel : ''}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8A6B5A">Prestation</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:500">${prestNom}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8A6B5A">Date</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:500">${dateStr}</td></tr>
            <tr><td style="padding:8px 0;${isPaidBooking ? 'border-bottom:1px solid #eee;' : ''}color:#8A6B5A">Heure</td><td style="padding:8px 0;${isPaidBooking ? 'border-bottom:1px solid #eee;' : ''}font-weight:500">${resa.heure_debut.slice(0,5)} – ${resa.heure_fin.slice(0,5)}</td></tr>
            ${isPaidBooking ? `<tr><td style="padding:8px 0;color:#8A6B5A">Montant reversé</td><td style="padding:8px 0;font-weight:500">${(Number(resa.montant_ht || 0) - Number(resa.montant_commission || 0)).toFixed(2)} €</td></tr>` : ''}
          </table>
          <a href="https://thepackclub.fr/espace-pro.html" style="display:inline-block;background:#C4693A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px">Gérer les réservations →</a>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
          <p style="font-size:12px;color:#aaa">The Pack Club · Espace Pro</p>
        </div>
      `);
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
