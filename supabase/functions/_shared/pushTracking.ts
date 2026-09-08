// Helper partage par les edge functions notify-* pour envoyer des push Expo tout en
// journalisant chaque campagne dans notifications_log (portee) et en reliant chaque
// message a ce log via data.notifLogId, pour que l'app puisse rapporter les ouvertures
// dans notification_opens (cf navigation/index.tsx cote mobile).
//
// Usage typique dans une edge function :
//   const logId = await createNotifLog(supabase, { type: 'new_offer', lieuId, title, body });
//   const messages = recipients.map(r => ({
//     to: r.push_token, title, body,
//     data: { type: 'new_offer', lieuId, notifLogId: logId },
//     sound: 'default', badge: 1,
//   }));
//   const tickets = await sendPushBatch(messages);
//   await finalizeNotifLog(supabase, logId, messages.length, tickets);

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string;
  badge?: number;
};

export type ExpoTicket = { status: 'ok' | 'error'; id?: string; message?: string; details?: unknown };

export async function createNotifLog(
  supabase: any,
  opts: { type: string; lieuId?: string | null; targetId?: string | null; title?: string; body?: string }
): Promise<string> {
  const { data, error } = await supabase
    .from('notifications_log')
    .insert({
      type: opts.type,
      lieu_id: opts.lieuId ?? null,
      target_id: opts.targetId ?? null,
      title: opts.title ?? null,
      body: opts.body ?? null,
    })
    .select('id')
    .single();
  if (error) {
    console.log('[pushTracking] createNotifLog error:', error.message);
    throw error;
  }
  return data.id as string;
}

// Envoie en batches de 100 (limite de l'API Expo) et renvoie les tickets a plat, dans le
// meme ordre que les messages -- necessaire pour retrouver les ids de receipt plus tard.
export async function sendPushBatch(messages: PushMessage[]): Promise<ExpoTicket[]> {
  const tickets: ExpoTicket[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      const json = await res.json();
      console.log('[pushTracking] expo batch', Math.floor(i / 100), ':', JSON.stringify(json).slice(0, 400));
      const batchTickets: ExpoTicket[] = Array.isArray(json?.data) ? json.data : [];
      tickets.push(...batchTickets);
    } catch (err) {
      console.log('[pushTracking] expo batch send failed:', (err as Error).message);
    }
  }
  return tickets;
}

export async function finalizeNotifLog(
  supabase: any,
  logId: string,
  recipientsCount: number,
  tickets: ExpoTicket[]
): Promise<void> {
  const ticketIds = tickets.map(t => t.id).filter(Boolean);
  await supabase
    .from('notifications_log')
    .update({ recipients_count: recipientsCount, ticket_ids: ticketIds })
    .eq('id', logId);
}

// Raccourci pour le cas le plus courant : un seul groupe de destinataires pour un type
// donne. Retourne le logId (utile si l'appelant veut l'inclure dans un post feed, etc.)
export async function sendTrackedPush(
  supabase: any,
  opts: { type: string; lieuId?: string | null; targetId?: string | null; title: string; body: string; recipients: { push_token: string }[]; extraData?: Record<string, unknown> }
): Promise<{ logId: string; sent: number }> {
  if (opts.recipients.length === 0) return { logId: '', sent: 0 };
  const logId = await createNotifLog(supabase, { type: opts.type, lieuId: opts.lieuId, targetId: opts.targetId, title: opts.title, body: opts.body });
  const messages: PushMessage[] = opts.recipients.map(r => ({
    to: r.push_token,
    title: opts.title,
    body: opts.body,
    data: { ...opts.extraData, type: opts.type, notifLogId: logId },
    sound: 'default',
    badge: 1,
  }));
  const tickets = await sendPushBatch(messages);
  await finalizeNotifLog(supabase, logId, messages.length, tickets);
  return { logId, sent: messages.length };
}
