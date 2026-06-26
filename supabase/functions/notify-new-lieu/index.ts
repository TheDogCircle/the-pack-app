import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const payload = await req.json();
  const record = payload.record;
  const oldRecord = payload.old_record;

  // Only trigger when actif switches false → true
  if (!record?.actif || oldRecord?.actif === true) {
    return new Response('skipped', { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: users } = await supabase
    .from('profils')
    .select('push_token, ville')
    .eq('notif_lieu_nearby', true)
    .not('push_token', 'is', null);

  if (!users || users.length === 0) {
    return new Response('no users', { status: 200 });
  }

  const lieuVille = (record.ville || '').toLowerCase().trim();

  // Notify users in the same city (or all if no city info)
  const targets = users.filter((u: any) => {
    if (!lieuVille || !u.ville) return true;
    const userVille = u.ville.toLowerCase().trim();
    return userVille.includes(lieuVille) || lieuVille.includes(userVille);
  });

  if (targets.length === 0) {
    return new Response('no nearby users', { status: 200 });
  }

  const messages = targets.map((u: any) => ({
    to: u.push_token,
    title: '🐾 Nouveau lieu dog-friendly !',
    body: `"${record.nom}" vient d'être ajouté${lieuVille ? ` à ${record.ville}` : ''} sur The Pack !`,
    data: { type: 'new_lieu', lieuId: record.id },
    sound: 'default',
    badge: 1,
  }));

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });

  return new Response(JSON.stringify({ sent: messages.length }), { status: 200 });
});
