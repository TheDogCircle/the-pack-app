import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createNotifLog, sendPushBatch, finalizeNotifLog, type PushMessage } from '../_shared/pushTracking.ts';

const TYPE_LABEL: Record<string, string> = {
  vaccin: 'Vaccin',
  vermifuge: 'Vermifuge',
  antiparasitaire: 'Antiparasitaire',
  rdv_veto: 'Rendez-vous véto',
};

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  console.log('[carnet-rappels] run start');

  const today = new Date().toISOString().slice(0, 10);

  // <= aujourd'hui (pas juste = aujourd'hui) : rattrape un rappel si le cron a saute un
  // jour, sans jamais le renvoyer une deuxieme fois grace a rappel_envoye.
  const { data: entries, error: entriesError } = await supabase
    .from('chien_carnet_entries')
    .select('id, chien_id, type, titre, date_rappel, chiens(id, nom, user_id)')
    .not('date_rappel', 'is', null)
    .eq('rappel_envoye', false)
    .lte('date_rappel', today);

  if (entriesError) {
    console.log('[carnet-rappels] entriesError:', entriesError.message);
    return new Response(JSON.stringify({ error: entriesError.message }), { status: 500 });
  }

  console.log('[carnet-rappels] entries due:', entries?.length || 0);

  const messages: PushMessage[] = [];
  const sentEntryIds: string[] = [];
  const logId = (entries && entries.length > 0)
    ? await createNotifLog(supabase, { type: 'carnet_rappel', title: 'Rappel carnet de santé', body: `${entries.length} rappel(s)` })
    : null;

  for (const entry of (entries || [])) {
    const chien = (entry as any).chiens;
    if (!chien?.user_id) { sentEntryIds.push(entry.id); continue; }

    const { data: owner } = await supabase
      .from('profils')
      .select('push_token, notif_carnet_rappel')
      .eq('id', chien.user_id)
      .maybeSingle();

    sentEntryIds.push(entry.id);

    if (!owner?.push_token) continue;
    if (owner.notif_carnet_rappel === false) continue;

    const label = TYPE_LABEL[entry.type] || 'Rappel';
    messages.push({
      to: owner.push_token,
      title: `Rappel — ${entry.titre || label}`,
      body: `${label} à prévoir pour ${chien.nom}.`,
      data: { type: 'carnet_rappel', chienId: chien.id, chienNom: chien.nom, entryId: entry.id, notifLogId: logId },
      sound: 'default',
      badge: 1,
    });
  }

  console.log('[carnet-rappels] notifications to send:', messages.length);

  if (logId && messages.length > 0) {
    const tickets = await sendPushBatch(messages);
    await finalizeNotifLog(supabase, logId, messages.length, tickets);
  }

  // Marque rappel_envoye pour TOUTES les entrees dues (meme sans token/opt-out) : sinon
  // une entree sans token relancerait cette requete indefiniment chaque jour.
  if (sentEntryIds.length > 0) {
    await supabase.from('chien_carnet_entries').update({ rappel_envoye: true }).in('id', sentEntryIds);
  }

  return new Response(JSON.stringify({ due: entries?.length || 0, sent: messages.length }), { status: 200 });
});
