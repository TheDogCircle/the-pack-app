import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Declenche par trg_notify_ticket_reply (AFTER INSERT sur ticket_messages,
// cf migration 20260930270000). Le trigger SQL ne filtre que sur la
// visibilite (client/pro) -- c'est ICI qu'on verifie que l'auteur est bien
// un admin, pour ne jamais notifier un client/pro de son propre message.
serve(async (req) => {
  const payload = await req.json();
  const message = payload.record;
  if (!message) return new Response('no record', { status: 200 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  if (!message.auteur_id) return new Response(JSON.stringify({ skipped: 'no auteur' }), { status: 200 });

  const { data: adminRole } = await supabase
    .from('admin_roles').select('role').eq('user_id', message.auteur_id).maybeSingle();
  if (!adminRole?.role) {
    return new Response(JSON.stringify({ skipped: 'not an admin reply' }), { status: 200 });
  }

  const { data: ticket } = await supabase
    .from('tickets').select('id, subject, requester_id, pro_account_type, pro_account_id')
    .eq('id', message.ticket_id).maybeSingle();
  if (!ticket) return new Response(JSON.stringify({ skipped: 'ticket not found' }), { status: 200 });

  let recipientUserId: string | null = null;
  if (message.visibilite === 'client') {
    recipientUserId = ticket.requester_id;
  } else if (message.visibilite === 'pro' && ticket.pro_account_type && ticket.pro_account_id) {
    const table = ticket.pro_account_type;
    const { data: account } = await supabase.from(table).select('manager_user_id').eq('id', ticket.pro_account_id).maybeSingle();
    recipientUserId = account?.manager_user_id ?? null;
  }
  if (!recipientUserId) return new Response(JSON.stringify({ skipped: 'no recipient' }), { status: 200 });

  const { data: profil } = await supabase
    .from('profils').select('push_token').eq('id', recipientUserId).not('push_token', 'is', null).maybeSingle();
  if (!profil?.push_token) return new Response(JSON.stringify({ skipped: 'no push token' }), { status: 200 });

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: profil.push_token,
      title: 'Nouvelle réponse à votre demande',
      body: ticket.subject,
      data: { type: 'ticket_reply', ticketId: ticket.id },
      sound: 'default',
      badge: 1,
    }),
  });

  return new Response(JSON.stringify({ sent: true }), { status: 200 });
});
