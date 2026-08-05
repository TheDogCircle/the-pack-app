import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const payload = await req.json();
  const record = payload.record;

  console.log('[notify-new-offer] triggered. prestation:', record?.nom, '| lieu_id:', record?.lieu_id, '| actif:', record?.actif);

  if (!record?.actif) {
    console.log('[notify-new-offer] skipped: not active');
    return new Response('skipped', { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: lieu } = await supabase.from('lieux').select('nom').eq('id', record.lieu_id).maybeSingle();
  const lieuNom = lieu?.nom || 'un partenaire';

  const { data: users, error: usersError } = await supabase
    .from('profils')
    .select('id, push_token')
    .or('notif_offer.is.null,notif_offer.eq.true')
    .not('push_token', 'is', null);

  console.log('[notify-new-offer] users query error:', usersError?.message ?? 'none', '| users found:', users?.length ?? 0);

  if (!users || users.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no matching users' }), { status: 200 });
  }

  const messages = users.map((u: any) => ({
    to: u.push_token,
    title: '✨ Nouvelle offre',
    body: `${lieuNom} propose "${record.nom}" !`,
    data: { type: 'new_offer', lieuId: record.lieu_id },
    sound: 'default',
    badge: 1,
  }));

  for (let i = 0; i < messages.length; i += 100) {
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
    const expoJson = await expoRes.json();
    console.log('[notify-new-offer] expo response batch', Math.floor(i / 100), ':', JSON.stringify(expoJson).slice(0, 500));
  }

  return new Response(JSON.stringify({ sent: messages.length }), { status: 200 });
});
