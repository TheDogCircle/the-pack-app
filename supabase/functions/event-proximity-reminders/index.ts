import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createNotifLog, sendPushBatch, finalizeNotifLog, type PushMessage } from '../_shared/pushTracking.ts';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Paliers en jours avant l'evenement, du plus loin au plus proche.
const PALIERS = [14, 7, 3, 1, 0];
const LABELS: Record<number, string> = {
  14: 'dans 2 semaines',
  7: 'dans 1 semaine',
  3: 'dans 3 jours',
  1: 'demain',
  0: "aujourd'hui",
};

// Tourne une fois par jour (cron, 8h UTC). Pour chaque evenement mis en avant
// et pas encore passe, envoie une notif de proximite a chaque palier atteint
// (14j, 7j, 3j, veille, jour meme), une seule fois par palier et par
// evenement -- trace via notif_paliers_envoyes (int[] sur l'evenement). Le
// .find sur PALIERS (du plus grand au plus petit) gere aussi le rattrapage :
// si le cron a manque un jour, il envoie au prochain passage le palier le
// plus proche encore du plutot que de le sauter silencieusement.
serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = new Date();

  const { data: events, error: eventsError } = await supabase
    .from('evenements')
    .select('id, titre, ville, adresse, lat, lng, date_heure, notif_paliers_envoyes')
    .eq('mise_en_avant', true).eq('valide', true).eq('actif', true)
    .gt('date_heure', now.toISOString());

  console.log('[event-proximity-reminders] events query error:', eventsError?.message ?? 'none', '| featured upcoming events:', events?.length ?? 0);

  if (!events || events.length === 0) {
    return new Response(JSON.stringify({ eventsChecked: 0, eventsNotified: 0, sent: 0 }), { status: 200 });
  }

  let eventsNotified = 0;
  let totalSent = 0;

  for (const event of events) {
    const joursAvant = Math.floor((new Date(event.date_heure).getTime() - now.getTime()) / (24 * 3600 * 1000));
    const sentPaliers: number[] = event.notif_paliers_envoyes || [];
    const duePalier = PALIERS.find(p => joursAvant <= p && !sentPaliers.includes(p));

    if (duePalier === undefined) {
      console.log('[event-proximity-reminders] skip (aucun palier du):', event.titre, '| joursAvant:', joursAvant, '| deja envoyes:', sentPaliers);
      continue;
    }

    const { data: users } = await supabase
      .from('profils')
      .select('id, push_token, lat, lng, ville, rayon_km')
      .or('notif_event_reminder.is.null,notif_event_reminder.eq.true')
      .not('push_token', 'is', null);

    const eventLat = event.lat ? parseFloat(event.lat as any) : null;
    const eventLng = event.lng ? parseFloat(event.lng as any) : null;
    const eventVille = (event.ville || '').toLowerCase().trim();
    const title = `${event.titre} — ${LABELS[duePalier]}`;

    const candidates: { push_token: string; distLabel: string }[] = [];
    for (const u of (users || [])) {
      let isNearby = false;
      let distKm: number | null = null;

      if (eventLat && eventLng && u.lat && u.lng) {
        distKm = Math.round(haversineKm(u.lat, u.lng, eventLat, eventLng) * 10) / 10;
        isNearby = distKm <= Math.min(u.rayon_km ?? 20, 20);
      } else if (eventVille && u.ville) {
        const userVille = u.ville.toLowerCase().trim();
        isNearby = userVille.includes(eventVille) || eventVille.includes(userVille);
      }
      if (!isNearby) continue;

      const distLabel = distKm !== null ? ` à ${distKm} km de toi` : (eventVille ? ` à ${event.ville}` : '');
      candidates.push({ push_token: u.push_token, distLabel });
    }

    console.log('[event-proximity-reminders] event:', event.titre, '| palier:', duePalier, 'j | joursAvant:', joursAvant, '| messages:', candidates.length);

    if (candidates.length > 0) {
      const logId = await createNotifLog(supabase, { type: 'event_reminder', targetId: event.id, title, body: `Un événement à ne pas manquer !` });
      const messages: PushMessage[] = candidates.map(c => ({
        to: c.push_token,
        title,
        body: `Un événement à ne pas manquer${c.distLabel} !`,
        data: { type: 'event_reminder', eventId: event.id, notifLogId: logId },
        sound: 'default',
        badge: 1,
      }));
      const tickets = await sendPushBatch(messages);
      await finalizeNotifLog(supabase, logId, messages.length, tickets);
      totalSent += messages.length;
    }

    await supabase.from('evenements').update({ notif_paliers_envoyes: [...sentPaliers, duePalier] }).eq('id', event.id);
    eventsNotified++;
  }

  return new Response(JSON.stringify({ eventsChecked: events.length, eventsNotified, sent: totalSent }), { status: 200 });
});
