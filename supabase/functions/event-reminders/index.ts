import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const tomorrowEnd   = new Date(todayEnd);   tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  const notifications: any[] = [];

  // ── J-1 reminders ──
  const { data: j1Events } = await supabase
    .from('evenements')
    .select('id, titre, date_heure, ville, adresse, rappel_j1_envoye')
    .eq('valide', true).eq('actif', true)
    .eq('rappel_j1_envoye', false)
    .gte('date_heure', tomorrowStart.toISOString())
    .lte('date_heure', tomorrowEnd.toISOString());

  for (const event of (j1Events || [])) {
    const { data: parts } = await supabase
      .from('participations')
      .select('user_id, profils(push_token)')
      .eq('event_id', event.id);

    const date = new Date(event.date_heure);
    const heureStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    for (const p of (parts || [])) {
      const token = (p as any).profils?.push_token;
      if (!token) continue;
      notifications.push({
        to: token,
        title: `Rappel — ${event.titre}`,
        body: `Demain à ${heureStr}${event.adresse ? ` · ${event.adresse}` : ''}${event.ville ? `, ${event.ville}` : ''}`,
        data: { type: 'event_reminder', eventId: event.id },
        sound: 'default',
        badge: 1,
      });
    }

    await supabase.from('evenements').update({ rappel_j1_envoye: true }).eq('id', event.id);
  }

  // ── J-0 reminders (morning of) ──
  const { data: j0Events } = await supabase
    .from('evenements')
    .select('id, titre, date_heure, ville, adresse, rappel_j0_envoye')
    .eq('valide', true).eq('actif', true)
    .eq('rappel_j0_envoye', false)
    .gte('date_heure', todayStart.toISOString())
    .lte('date_heure', todayEnd.toISOString());

  for (const event of (j0Events || [])) {
    const { data: parts } = await supabase
      .from('participations')
      .select('user_id, profils(push_token)')
      .eq('event_id', event.id);

    const date = new Date(event.date_heure);
    const heureStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    for (const p of (parts || [])) {
      const token = (p as any).profils?.push_token;
      if (!token) continue;
      notifications.push({
        to: token,
        title: `C'est aujourd'hui ! ${event.titre}`,
        body: `Rendez-vous à ${heureStr}${event.adresse ? ` · ${event.adresse}` : ''}${event.ville ? `, ${event.ville}` : ''}`,
        data: { type: 'event_reminder_today', eventId: event.id },
        sound: 'default',
        badge: 1,
      });
    }

    await supabase.from('evenements').update({ rappel_j0_envoye: true }).eq('id', event.id);
  }

  // Send all notifications in batches of 100
  for (let i = 0; i < notifications.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(notifications.slice(i, i + 100)),
    });
  }

  return new Response(JSON.stringify({ j1: j1Events?.length || 0, j0: j0Events?.length || 0, sent: notifications.length }), { status: 200 });
});
