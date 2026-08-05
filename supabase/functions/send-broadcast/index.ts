import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ADMIN_IDS = ['28f8c781-f384-4fcd-89a2-6347e7ca352a', '69a4bea8-8e26-4c07-8fae-b7ab6b6f39ed'];

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace('Bearer ', '');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Verifie que l'appelant est bien un admin connu
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user || !ADMIN_IDS.includes(user.id)) {
    return new Response(JSON.stringify({ error: 'Non autorise' }), { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.title || !body.body) {
    return new Response(JSON.stringify({ error: 'title et body requis' }), { status: 400 });
  }

  const { title, body: message, target_type, target_id, url, test_user_id } = body as {
    title: string; body: string;
    target_type?: 'lieu' | 'event' | 'conversation' | 'url' | 'none';
    target_id?: string; url?: string; test_user_id?: string;
  };

  const data: Record<string, unknown> = { type: 'broadcast' };
  if (target_type === 'lieu' && target_id) { data.targetType = 'lieu'; data.lieuId = target_id; }
  else if (target_type === 'event' && target_id) { data.targetType = 'event'; data.eventId = target_id; }
  else if (target_type === 'conversation' && target_id) { data.targetType = 'conversation'; data.conversationId = target_id; }
  else if (target_type === 'url' && url) { data.targetType = 'url'; data.url = url; }

  let usersQuery = supabase
    .from('profils')
    .select('id, push_token')
    .not('push_token', 'is', null);
  usersQuery = test_user_id
    ? usersQuery.eq('id', test_user_id)
    : usersQuery.or('notif_broadcast.is.null,notif_broadcast.eq.true');
  const { data: users, error: usersError } = await usersQuery;

  if (usersError) {
    return new Response(JSON.stringify({ error: usersError.message }), { status: 500 });
  }
  if (!users || users.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no matching users' }), { status: 200 });
  }

  const messages = users.map((u: any) => ({
    to: u.push_token,
    title,
    body: message,
    data,
    sound: 'default',
    badge: 1,
  }));

  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
    if (expoRes.ok) sent += Math.min(100, messages.length - i);
    const expoJson = await expoRes.json().catch(() => null);
    console.log('[send-broadcast] batch', Math.floor(i / 100), JSON.stringify(expoJson).slice(0, 300));
  }

  return new Response(JSON.stringify({ sent, total: messages.length }), { status: 200 });
});
