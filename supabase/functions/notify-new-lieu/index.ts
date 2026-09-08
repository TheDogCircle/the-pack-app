import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTrackedPush, createNotifLog, sendPushBatch, finalizeNotifLog, type PushMessage } from '../_shared/pushTracking.ts';

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

  console.log('[notify-new-lieu] triggered. lieu:', record?.nom, '| actif:', record?.actif, '| old actif:', oldRecord?.actif, '| ville:', record?.ville, '| lat:', record?.lat, '| lng:', record?.lng);

  // Only trigger when actif switches false → true
  if (!record?.actif || oldRecord?.actif === true) {
    console.log('[notify-new-lieu] skipped: not an activation');
    return new Response('skipped', { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Garde-fou : un lieu cree/gere par un compte de test ne genere ni post de
  // feed ni notification au grand public — juste un ping sur l'appareil de test.
  const testUserIds = (Deno.env.get('TEST_USER_IDS') ?? '').split(',').filter(Boolean);
  const testPushToken = Deno.env.get('TEST_PUSH_TOKEN');
  const isTestLieu = (!!record.manager_user_id && testUserIds.includes(record.manager_user_id))
    || (!!record.submitted_by && testUserIds.includes(record.submitted_by));

  if (isTestLieu) {
    console.log('[notify-new-lieu] lieu de test — pas de post feed, notification limitee a TEST_PUSH_TOKEN');
    if (testPushToken) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify([{
          to: testPushToken,
          title: '[TEST] Nouveau lieu',
          body: `"${record.nom}" vient d'être ajouté.`,
          data: { type: 'new_lieu', lieuId: record.id },
          sound: 'default',
          badge: 1,
        }]),
      });
    }
    return new Response(JSON.stringify({ sent: testPushToken ? 1 : 0, test: true }), { status: 200 });
  }

  // 0a. Auto-validate photos and videos attached to this lieu
  await Promise.all([
    supabase.from('photos').update({ validee: true }).eq('lieu_id', record.id).eq('validee', false),
    supabase.from('videos').update({ validee: true }).eq('lieu_id', record.id).eq('validee', false),
  ]);
  console.log('[notify-new-lieu] photos/videos validated for lieu:', record.nom);

  // 0b. Create a feed post for this validated lieu
  if (record.submitted_by) {
    const { error: postErr } = await supabase.from('community_posts').insert({
      user_id: record.submitted_by,
      type: 'nouveau_lieu',
      lieu_id: record.id,
      auto_generated: true,
      image_url: null,
    });
    if (postErr) console.log('[notify-new-lieu] feed post skipped (likely duplicate):', postErr.message);
    else console.log('[notify-new-lieu] feed post created for lieu:', record.nom);
  } else {
    console.log('[notify-new-lieu] no submitted_by — feed post skipped');
  }

  const notifiedIds = new Set<string>();
  let totalSent = 0;

  // 1. Notify the submitter: "ta suggestion a été validée" — envoi individuel, pas de
  // suivi de campagne (un seul destinataire, aucune valeur en tant que metrique de portee).
  if (record.submitted_by) {
    const { data: submitter } = await supabase
      .from('profils')
      .select('id, push_token')
      .eq('id', record.submitted_by)
      .not('push_token', 'is', null)
      .maybeSingle();

    console.log('[notify-new-lieu] submitter token:', submitter?.push_token ? 'found' : 'null/missing');

    if (submitter?.push_token) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify([{
          to: submitter.push_token,
          title: 'Ta suggestion a été validée',
          body: `"${record.nom}" est maintenant visible sur la carte !`,
          data: { type: 'suggestion_validee', lieuId: record.id },
          sound: 'default',
          badge: 1,
        }]),
      });
      notifiedIds.add(submitter.id);
      totalSent++;
    }
  }

  // 1.5 Notify followers of the submitter: "un ami a ajouté un lieu"
  if (record.submitted_by) {
    const { data: followerRows } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', record.submitted_by)
      .eq('statut', 'accepte');

    const followerIds = (followerRows || []).map((f: any) => f.follower_id).filter((id: string) => !notifiedIds.has(id));

    if (followerIds.length > 0) {
      const { data: submitterProfil } = await supabase
        .from('profils').select('prenom').eq('id', record.submitted_by).maybeSingle();
      const submitterPrenom = submitterProfil?.prenom || 'Un ami';

      const { data: followers } = await supabase
        .from('profils')
        .select('id, push_token')
        .in('id', followerIds)
        .or('notif_friend_lieu.is.null,notif_friend_lieu.eq.true')
        .not('push_token', 'is', null);

      const { sent } = await sendTrackedPush(supabase, {
        type: 'friend_lieu',
        lieuId: record.id,
        title: 'Nouveau lieu ajouté',
        body: `${submitterPrenom} a ajouté "${record.nom}" sur The Pack !`,
        recipients: (followers || []).map((f: any) => ({ push_token: f.push_token })),
        extraData: { lieuId: record.id },
      });
      (followers || []).forEach((f: any) => notifiedIds.add(f.id));
      totalSent += sent;
      console.log('[notify-new-lieu] followers notified:', (followers || []).length);
    }
  }

  // 2. Notify nearby users
  const { data: users, error: usersError } = await supabase
    .from('profils')
    .select('id, push_token, lat, lng, ville, rayon_km')
    .or('notif_lieu_nearby.is.null,notif_lieu_nearby.eq.true')
    .not('push_token', 'is', null);

  console.log('[notify-new-lieu] users query error:', usersError?.message ?? 'none', '| users found:', users?.length ?? 0);

  if (users && users.length > 0) {
    const lieuLat = record.lat ? parseFloat(record.lat) : null;
    const lieuLng = record.lng ? parseFloat(record.lng) : null;
    const lieuVille = (record.ville || '').toLowerCase().trim();

    let matchedByDist = 0, matchedByVille = 0, skippedNoData = 0, skippedTooFar = 0;
    const nearbyMessages: PushMessage[] = [];
    const title = 'Nouveau lieu dog-friendly près de toi !';

    // Chaque destinataire a sa propre distance dans le corps du message -- on garde donc
    // ce groupe en dehors de sendTrackedPush (qui suppose un titre/corps uniques pour
    // toute la campagne) et on cree/finalise le log manuellement autour de la boucle.
    const logId = users.length ? await createNotifLog(supabase, { type: 'new_lieu', lieuId: record.id, title, body: record.nom }) : null;

    for (const u of users) {
      if (notifiedIds.has(u.id)) continue;

      let isNearby = false;
      let distKm: number | null = null;

      if (lieuLat && lieuLng && u.lat && u.lng) {
        distKm = Math.round(haversineKm(u.lat, u.lng, lieuLat, lieuLng) * 10) / 10;
        isNearby = distKm <= (u.rayon_km ?? 20);
        if (!isNearby) skippedTooFar++;
        else matchedByDist++;
      } else if (lieuVille && u.ville) {
        const userVille = u.ville.toLowerCase().trim();
        isNearby = userVille.includes(lieuVille) || lieuVille.includes(userVille);
        if (isNearby) matchedByVille++;
        else skippedTooFar++;
      } else {
        skippedNoData++;
        continue;
      }

      if (!isNearby) continue;

      const distLabel = distKm !== null ? ` à ${distKm} km de toi` : (lieuVille ? ` à ${record.ville}` : '');
      nearbyMessages.push({
        to: u.push_token,
        title,
        body: `"${record.nom}"${distLabel} vient d'être ajouté sur The Pack !`,
        data: { type: 'new_lieu', lieuId: record.id, notifLogId: logId },
        sound: 'default',
        badge: 1,
      });
    }

    console.log('[notify-new-lieu] match stats — byDist:', matchedByDist, '| byVille:', matchedByVille, '| tooFar:', skippedTooFar, '| noData:', skippedNoData);

    if (logId && nearbyMessages.length > 0) {
      const tickets = await sendPushBatch(nearbyMessages);
      await finalizeNotifLog(supabase, logId, nearbyMessages.length, tickets);
      totalSent += nearbyMessages.length;
    }
  }

  console.log('[notify-new-lieu] total messages sent:', totalSent);

  return new Response(JSON.stringify({ sent: totalSent }), { status: 200 });
});
