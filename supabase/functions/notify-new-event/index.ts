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

serve(async (req) => {
  const payload = await req.json();
  const record = payload.record;
  const oldRecord = payload.old_record;

  // Only trigger when valide switches false → true
  if (!record?.valide || oldRecord?.valide === true) {
    return new Response('skipped', { status: 200 });
  }
  if (!record.lat || !record.lng) {
    return new Response('no coordinates', { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Fetch users with push tokens and their city coordinates
  const { data: users } = await supabase
    .from('profils')
    .select('id, push_token, ville, lat, lng')
    .not('push_token', 'is', null);

  if (!users || users.length === 0) return new Response('no users', { status: 200 });

  const eventLat = record.lat;
  const eventLng = record.lng;
  const date = new Date(record.date_heure);
  const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heureStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // For users without coordinates, geocode their ville via Nominatim
  const usersWithCoords = await Promise.all(users.map(async (u: any) => {
    if (u.lat && u.lng) return u;
    if (!u.ville) return null;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(u.ville + ', France')}&limit=1`,
        { headers: { 'User-Agent': 'ThePack/1.0' } }
      );
      const data = await res.json();
      if (data.length > 0) return { ...u, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    } catch (_) {}
    return null;
  }));

  const targets = usersWithCoords
    .filter((u): u is NonNullable<typeof u> => u !== null && u.id !== record.organisateur_id)
    .filter(u => haversineKm(u.lat, u.lng, eventLat, eventLng) <= 20);

  if (targets.length === 0) return new Response('no nearby users', { status: 200 });

  const messages = targets.map((u: any) => ({
    to: u.push_token,
    title: '📅 Événement près de chez vous !',
    body: `"${record.titre}" — ${dateStr} à ${heureStr}${record.ville ? ` · ${record.ville}` : ''}`,
    data: { type: 'new_event', eventId: record.id },
    sound: 'default',
    badge: 1,
  }));

  // Send in batches of 100 (Expo limit)
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }

  return new Response(JSON.stringify({ sent: messages.length }), { status: 200 });
});
