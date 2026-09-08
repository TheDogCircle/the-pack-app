import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Verifie les accuses de livraison Expo pour les campagnes envoyees il y a plus de
// 15 minutes (delai recommande par Expo pour laisser le temps aux receipts d'etre
// disponibles) et pas encore verifiees. Tourne via pg_cron toutes les 30 minutes.
// cf _shared/pushTracking.ts pour la creation des logs et le stockage des ticket_ids.

const RECEIPT_DELAY_MINUTES = 15;
const MAX_LOGS_PER_RUN = 50;
const EXPO_RECEIPT_CHUNK = 1000; // limite Expo par appel getReceipts

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const cutoff = new Date(Date.now() - RECEIPT_DELAY_MINUTES * 60_000).toISOString();

  const { data: logs, error } = await supabase
    .from('notifications_log')
    .select('id, ticket_ids')
    .is('receipts_checked_at', null)
    .lt('created_at', cutoff)
    .not('ticket_ids', 'eq', '[]')
    .order('created_at', { ascending: true })
    .limit(MAX_LOGS_PER_RUN);

  if (error) {
    console.log('[check-notification-receipts] query error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  console.log('[check-notification-receipts] logs to check:', logs?.length ?? 0);

  let checked = 0;
  for (const log of (logs || [])) {
    const ids: string[] = Array.isArray(log.ticket_ids) ? log.ticket_ids : [];
    if (ids.length === 0) {
      await supabase.from('notifications_log').update({ receipts_checked_at: new Date().toISOString() }).eq('id', log.id);
      continue;
    }

    let delivered = 0, failed = 0;
    try {
      for (let i = 0; i < ids.length; i += EXPO_RECEIPT_CHUNK) {
        const chunk = ids.slice(i, i + EXPO_RECEIPT_CHUNK);
        const res = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ ids: chunk }),
        });
        const json = await res.json();
        const receipts = json?.data || {};
        for (const id of chunk) {
          const status = receipts[id]?.status;
          if (status === 'ok') delivered++;
          else if (status === 'error') failed++;
          // absent du retour Expo = pas encore de receipt dispo, ni compte ni echec pour cette passe
        }
      }
    } catch (err) {
      console.log('[check-notification-receipts] getReceipts failed for log', log.id, ':', (err as Error).message);
      continue; // on retentera au prochain run (receipts_checked_at pas mis a jour)
    }

    await supabase.from('notifications_log').update({
      delivered_count: delivered,
      failed_count: failed,
      receipts_checked_at: new Date().toISOString(),
    }).eq('id', log.id);
    checked++;
  }

  return new Response(JSON.stringify({ checked }), { status: 200 });
});
