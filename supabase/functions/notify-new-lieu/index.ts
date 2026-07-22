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

  // Only trigger when actif switches false → true
  if (!record?.actif || oldRecord?.actif === true) {
    return new Response('skipped', { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const messages: object[] = [];
  const notifiedIds = new Set<string>();

  // 1. Notify the submitter: "ta suggestion a été validée"
  if (record.submitted_by) {
    const { data: submitter } = await supabase
      .from('profils')
      .select('id, push_token')
      .eq('id', record.submitted_by)
      .not('push_token', 'is', null)
      .maybeSingle();

    if (submitter?.push_token) {
      messages.push({
        to: submitter.push_token,
        title: 'Ta suggestion a été validée 🐾',
        body: `"${record.nom}" est maintenant visible sur la carte !`,
        data: { type: 'suggestion_validee', lieuId: record.id },
        sound: 'default',
        badge: 1,
      });
      notifiedIds.add(submitter.id);
    }
  }

  // 2. Notify nearby users
  // Use .or() to include users with notif_lieu_nearby = true OR null (default = opt-in)
  const { data: users } = await supabase
    .from('profils')
    .select('id, push_token, lat, lng, ville')
    .or('notif_lieu_nearby.is.null,notif_lieu_nearby.eq.true')
    .not('push_token', 'is', null);

  if (users && users.length > 0) {
    const lieuLat = record.lat ? parseFloat(record.lat) : null;
    const lieuLng = record.lng ? parseFloat(record.lng) : null;
    const lieuVille = (record.ville || '').toLowerCase().trim();

    for (const u of users) {
      if (notifiedIds.has(u.id)) continue;

      let isNearby = false;
      let distKm: number | null = null;

      if (lieuLat && lieuLng && u.lat && u.lng) {
        distKm = Math.round(haversineKm(u.lat, u.lng, lieuLat, lieuLng) * 10) / 10;
        isNearby = distKm <= 15;
      } else if (lieuVille && u.ville) {
        const userVille = u.ville.toLowerCase().trim();
        isNearby = userVille.includes(lieuVille) || lieuVille.includes(userVille);
      } else {
        // No location data on either side — skip (avoid spamming everyone)
        continue;
      }

      if (!isNearby) continue;

      const distLabel = distKm !== null ? ` à ${distKm} km de toi` : (lieuVille ? ` à ${record.ville}` : '');
      messages.push({
        to: u.push_token,
        title: '🐶 Nouveau lieu dog-friendly près de toi !',
        body: `"${record.nom}"${distLabel} vient d'être ajouté sur The Pack !`,
        data: { type: 'new_lieu', lieuId: record.id },
        sound: 'default',
        badge: 1,
      });
    }
  }

  if (messages.length === 0) {
    return new Response(JSON.stringify({ sent: 0, skipped: 'no targets' }), { status: 200 });
  }

  // Send in batches of 100 (Expo push API limit)
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }

  return new Response(JSON.stringify({ sent: messages.length }), { status: 200 });
});
