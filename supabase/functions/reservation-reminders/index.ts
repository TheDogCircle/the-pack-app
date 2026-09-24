import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTrackedPush } from '../_shared/pushTracking.ts';

// Rappels de reservation confirmee (promenade / seance educateur) : J-3, la
// veille, et le jour meme -- au client ET au prestataire, chacun avec son
// propre message. Meme pattern que event-reminders (flags booleens par
// palier sur la ligne elle-meme pour ne jamais renvoyer deux fois).
serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  function dateStr(daysFromNow: number) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d.toISOString().slice(0, 10);
  }

  const tiers: { flag: string; days: number; label: (heure: string) => string }[] = [
    { flag: 'rappel_j3_envoye', days: 3, label: h => `Dans 3 jours à ${h}` },
    { flag: 'rappel_j1_envoye', days: 1, label: h => `Demain à ${h}` },
    { flag: 'rappel_j0_envoye', days: 0, label: h => `Aujourd'hui à ${h}` },
  ];

  let totalSent = 0;
  const counts: Record<string, number> = {};

  for (const tier of tiers) {
    const targetDate = dateStr(tier.days);
    const { data: resas } = await supabase
      .from('reservations')
      .select('id, date, heure_debut, client_prenom, user_id, lieu_id, prestation_id')
      .eq('statut', 'confirmee')
      .eq('date', targetDate)
      .eq(tier.flag, false);

    counts[tier.flag] = resas?.length || 0;
    if (!resas || !resas.length) continue;

    const lieuIds = [...new Set(resas.map(r => r.lieu_id))];
    const prestaIds = [...new Set(resas.map(r => r.prestation_id))];
    const userIds = [...new Set(resas.map(r => r.user_id))];

    const [{ data: lieux }, { data: prestations }] = await Promise.all([
      supabase.from('lieux').select('id, nom, manager_user_id').in('id', lieuIds),
      supabase.from('prestations').select('id, nom').in('id', prestaIds),
    ]);
    const lieuById = Object.fromEntries((lieux || []).map(l => [l.id, l]));
    const prestaById = Object.fromEntries((prestations || []).map(p => [p.id, p]));

    const managerIds = [...new Set((lieux || []).map(l => l.manager_user_id).filter(Boolean))];
    const profilIds = [...new Set([...userIds, ...managerIds])];
    const { data: profils } = await supabase.from('profils').select('id, push_token').in('id', profilIds);
    const pushByUser = Object.fromEntries((profils || []).map(p => [p.id, p.push_token]));

    for (const resa of resas) {
      const lieu = lieuById[resa.lieu_id];
      const presta = prestaById[resa.prestation_id];
      const heure = (resa.heure_debut || '').slice(0, 5);
      const quand = tier.label(heure);

      // 'reservation' / 'new_reservation' : types deja geres par le routage au tap
      // (navigation/index.tsx) -- 'reservation' ouvre MesReservations cote client,
      // 'new_reservation' ouvre l'espace pro web cote prestataire.
      const clientToken = pushByUser[resa.user_id];
      if (clientToken) {
        const { sent } = await sendTrackedPush(supabase, {
          type: 'reservation',
          lieuId: resa.lieu_id,
          targetId: resa.id,
          title: `Rappel — ${presta?.nom || 'ta réservation'}`,
          body: `${quand} chez ${lieu?.nom || 'ton prestataire'}`,
          recipients: [{ push_token: clientToken }],
          extraData: { reservationId: resa.id, lieuId: resa.lieu_id },
        });
        totalSent += sent;
      }

      const providerToken = lieu?.manager_user_id ? pushByUser[lieu.manager_user_id] : null;
      if (providerToken) {
        const { sent } = await sendTrackedPush(supabase, {
          type: 'new_reservation',
          lieuId: resa.lieu_id,
          targetId: resa.id,
          title: `Rappel — ${presta?.nom || 'RDV'} avec ${resa.client_prenom || 'un client'}`,
          body: quand,
          recipients: [{ push_token: providerToken }],
          extraData: { reservationId: resa.id, lieuId: resa.lieu_id },
        });
        totalSent += sent;
      }

      await supabase.from('reservations').update({ [tier.flag]: true }).eq('id', resa.id);
    }
  }

  return new Response(JSON.stringify({ ...counts, sent: totalSent }), { status: 200 });
});
