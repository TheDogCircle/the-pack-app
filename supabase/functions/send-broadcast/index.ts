import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ADMIN_IDS = ['28f8c781-f384-4fcd-89a2-6347e7ca352a', '69a4bea8-8e26-4c07-8fae-b7ab6b6f39ed'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace('Bearer ', '');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Verifie que l'appelant est bien un admin connu
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user || !ADMIN_IDS.includes(user.id)) {
    return new Response(JSON.stringify({ error: 'Non autorise' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return new Response(JSON.stringify({ error: 'Corps de requete invalide' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const {
    title, body: message, target_type, target_id, url, test_user_id,
    ville, preview,
  } = body as {
    title?: string; body?: string;
    target_type?: 'lieu' | 'event' | 'conversation' | 'url' | 'none';
    target_id?: string; url?: string; test_user_id?: string;
    ville?: string; preview?: boolean;
  };

  // Construit la requete de destinataires (reutilisee pour l'apercu et l'envoi)
  let usersQuery = supabase
    .from('profils')
    .select('id, prenom, ville, push_token')
    .not('push_token', 'is', null);
  if (test_user_id) {
    usersQuery = usersQuery.eq('id', test_user_id);
  } else {
    usersQuery = usersQuery.or('notif_broadcast.is.null,notif_broadcast.eq.true');
    if (ville) usersQuery = usersQuery.eq('ville', ville);
  }
  const { data: users, error: usersError } = await usersQuery;

  if (usersError) {
    return new Response(JSON.stringify({ error: usersError.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Mode apercu : renvoie juste la liste des destinataires, n'envoie rien
  if (preview) {
    return new Response(JSON.stringify({
      count: users?.length || 0,
      users: (users || []).map((u: any) => ({ id: u.id, prenom: u.prenom, ville: u.ville })),
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (!title || !message) {
    return new Response(JSON.stringify({ error: 'title et body requis' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const data: Record<string, unknown> = { type: 'broadcast' };
  if (target_type === 'lieu' && target_id) { data.targetType = 'lieu'; data.lieuId = target_id; }
  else if (target_type === 'event' && target_id) { data.targetType = 'event'; data.eventId = target_id; }
  else if (target_type === 'conversation' && target_id) { data.targetType = 'conversation'; data.conversationId = target_id; }
  else if (target_type === 'url' && url) { data.targetType = 'url'; data.url = url; }

  if (!users || users.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no matching users' }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
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

  return new Response(JSON.stringify({ sent, total: messages.length }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
