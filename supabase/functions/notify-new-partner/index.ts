import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const payload = await req.json();
  const record = payload.record;
  const oldRecord = payload.old_record;

  console.log('[notify-new-partner] triggered. lieu:', record?.nom, '| manager_user_id:', record?.manager_user_id, '| old manager_user_id:', oldRecord?.manager_user_id);

  // Only trigger when manager_user_id switches from null → set (a lieu becomes a claimed partner),
  // AND the lieu is actually live (actif) — a lieu can get manager_user_id set while still
  // pending admin validation (actif=false), which must never trigger a public announcement.
  if (!record?.manager_user_id || oldRecord?.manager_user_id || !record?.actif) {
    console.log('[notify-new-partner] skipped: not a new claim, or lieu not active yet');
    return new Response('skipped', { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Garde-fou : un lieu revendique par un compte de test ne notifie jamais le
  // grand public, seulement l'appareil de test dedie.
  const testUserIds = (Deno.env.get('TEST_USER_IDS') ?? '').split(',').filter(Boolean);
  const testPushToken = Deno.env.get('TEST_PUSH_TOKEN');
  const isTestLieu = testUserIds.includes(record.manager_user_id);

  let messages: object[];

  if (isTestLieu) {
    console.log('[notify-new-partner] lieu revendique par un compte de test — notification limitee a TEST_PUSH_TOKEN');
    messages = testPushToken
      ? [{
          to: testPushToken,
          title: '🏪 [TEST] Nouveau partenaire',
          body: `"${record.nom}" vient de rejoindre The Pack !`,
          data: { type: 'new_partner', lieuId: record.id },
          sound: 'default',
          badge: 1,
        }]
      : [];
  } else {
    const { data: users, error: usersError } = await supabase
      .from('profils')
      .select('id, push_token')
      .or('notif_partner.is.null,notif_partner.eq.true')
      .not('push_token', 'is', null);

    console.log('[notify-new-partner] users query error:', usersError?.message ?? 'none', '| users found:', users?.length ?? 0);

    messages = (users || []).map((u: any) => ({
      to: u.push_token,
      title: '🏪 Nouveau partenaire',
      body: `"${record.nom}" vient de rejoindre The Pack !`,
      data: { type: 'new_partner', lieuId: record.id },
      sound: 'default',
      badge: 1,
    }));
  }

  if (messages.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no matching users' }), { status: 200 });
  }

  for (let i = 0; i < messages.length; i += 100) {
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
    const expoJson = await expoRes.json();
    console.log('[notify-new-partner] expo response batch', Math.floor(i / 100), ':', JSON.stringify(expoJson).slice(0, 500));
  }

  return new Response(JSON.stringify({ sent: messages.length }), { status: 200 });
});
