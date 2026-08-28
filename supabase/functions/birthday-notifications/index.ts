import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  console.log('[birthday-notifications] run start');

  const now = new Date();
  const todayMonth = String(now.getMonth() + 1).padStart(2, '0');
  const todayDay = String(now.getDate()).padStart(2, '0');

  // date_naissance_parsed comes back as "YYYY-MM-DD" — compare as strings to avoid timezone drift.
  const { data: dogs, error: dogsError } = await supabase
    .from('chiens')
    .select('id, nom, user_id, date_naissance_parsed')
    .not('date_naissance_parsed', 'is', null);

  if (dogsError) {
    console.log('[birthday-notifications] dogsError:', dogsError.message);
    return new Response(JSON.stringify({ error: dogsError.message }), { status: 500 });
  }

  const todaysDogs = (dogs || []).filter(d => {
    const parsed = d.date_naissance_parsed as string;
    return parsed.slice(5, 7) === todayMonth && parsed.slice(8, 10) === todayDay;
  });

  console.log('[birthday-notifications] dogs with birthday today:', todaysDogs.length);

  const notifications: any[] = [];

  for (const dog of todaysDogs) {
    const { data: owner } = await supabase
      .from('profils')
      .select('id, prenom')
      .eq('id', dog.user_id)
      .maybeSingle();

    const { data: followRows } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', dog.user_id)
      .eq('statut', 'accepte');

    const followerIds = (followRows || []).map(f => f.follower_id);
    if (!followerIds.length) continue;

    const { data: followers, error: followersError } = await supabase
      .from('profils')
      .select('id, push_token')
      .in('id', followerIds)
      .or('notif_birthday.is.null,notif_birthday.eq.true')
      .not('push_token', 'is', null);

    if (followersError) {
      console.log('[birthday-notifications] followersError for dog', dog.id, ':', followersError.message);
      continue;
    }

    for (const f of (followers || [])) {
      notifications.push({
        to: f.push_token,
        title: '🎂 Anniversaire !',
        body: `C'est l'anniversaire de ${dog.nom} (chez ${owner?.prenom || 'un copain'}) !`,
        data: { type: 'dog_birthday', chienId: dog.id, ownerId: dog.user_id },
        sound: 'default',
        badge: 1,
      });
    }
  }

  console.log('[birthday-notifications] notifications to send:', notifications.length);

  for (let i = 0; i < notifications.length; i += 100) {
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(notifications.slice(i, i + 100)),
    });
    const expoJson = await expoRes.json();
    console.log('[birthday-notifications] expo response batch', Math.floor(i / 100), ':', JSON.stringify(expoJson).slice(0, 500));
  }

  return new Response(JSON.stringify({ dogsToday: todaysDogs.length, sent: notifications.length }), { status: 200 });
});
