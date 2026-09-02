import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Tourne une fois par jour (cron). Pour chaque evenement mis en avant et pas
// encore passe, decide si c'est le jour d'envoyer une notif de proximite :
// une fois par semaine tant que l'evenement est a plus de 14 jours, puis tous
// les 5 jours en dessous de ce seuil. derniere_notif_proximite_at (sur
// l'evenement) sert de curseur — pas de table de log separee necessaire, un
// cron quotidien ne peut jamais renvoyer deux fois la meme notif le meme jour.
serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = new Date();

  const { data: events, error: eventsError } = await supabase
    .from('evenements')
    .select('id, titre, ville, adresse, lat, lng, date_heure, derniere_notif_proximite_at')
    .eq('mise_en_avant', true).eq('valide', true).eq('actif', true)
    .gt('date_heure', now.toISOString());

  console.log('[event-proximity-reminders] events query error:', eventsError?.message ?? 'none', '| featured upcoming events:', events?.length ?? 0);

  if (!events || events.length === 0) {
    return new Response(JSON.stringify({ eventsChecked: 0, eventsNotified: 0, sent: 0 }), { status: 200 });
  }

  let eventsNotified = 0;
  let totalSent = 0;

  for (const event of events) {
    const joursAvant = (new Date(event.date_heure).getTime() - now.getTime()) / (24 * 3600 * 1000);
    const cadenceJours = joursAvant > 14 ? 7 : 5;

    const derniere = event.derniere_notif_proximite_at ? new Date(event.derniere_notif_proximite_at) : null;
    const due = !derniere || (now.getTime() - derniere.getTime()) >= cadenceJours * 24 * 3600 * 1000;

    if (!due) {
      console.log('[event-proximity-reminders] skip (pas encore due):', event.titre, '| cadence:', cadenceJours, 'j | derniere:', event.derniere_notif_proximite_at ?? 'jamais');
      continue;
    }

    const { data: users } = await supabase
      .from('profils')
      .select('id, push_token, lat, lng, ville, rayon_km')
      .or('notif_event_reminder.is.null,notif_event_reminder.eq.true')
      .not('push_token', 'is', null);

    const messages: object[] = [];
    const eventLat = event.lat ? parseFloat(event.lat as any) : null;
    const eventLng = event.lng ? parseFloat(event.lng as any) : null;
    const eventVille = (event.ville || '').toLowerCase().trim();
    const joursLabel = Math.round(joursAvant);

    for (const u of (users || [])) {
      let isNearby = false;
      let distKm: number | null = null;

      if (eventLat && eventLng && u.lat && u.lng) {
        distKm = Math.round(haversineKm(u.lat, u.lng, eventLat, eventLng) * 10) / 10;
        isNearby = distKm <= (u.rayon_km ?? 20);
      } else if (eventVille && u.ville) {
        const userVille = u.ville.toLowerCase().trim();
        isNearby = userVille.includes(eventVille) || eventVille.includes(userVille);
      }
      if (!isNearby) continue;

      const distLabel = distKm !== null ? ` à ${distKm} km de toi` : (eventVille ? ` à ${event.ville}` : '');
      messages.push({
        to: u.push_token,
        title: `${event.titre} — dans ${joursLabel} jour${joursLabel > 1 ? 's' : ''}`,
        body: `Un événement à ne pas manquer${distLabel} !`,
        data: { type: 'event_reminder', eventId: event.id },
        sound: 'default',
        badge: 1,
      });
    }

    console.log('[event-proximity-reminders] event:', event.titre, '| joursAvant:', joursLabel, '| cadence:', cadenceJours, '| messages:', messages.length);

    for (let i = 0; i < messages.length; i += 100) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
    }

    await supabase.from('evenements').update({ derniere_notif_proximite_at: now.toISOString() }).eq('id', event.id);
    eventsNotified++;
    totalSent += messages.length;
  }

  return new Response(JSON.stringify({ eventsChecked: events.length, eventsNotified, sent: totalSent }), { status: 200 });
});
