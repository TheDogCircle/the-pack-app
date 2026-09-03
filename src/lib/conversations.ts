import { supabase } from './supabase';

// Retrouve ou cree une conversation directe (DM) entre l'utilisateur courant et
// otherId. Contrairement a MessagerieScreen.findExistingDM (qui ne peut retourner
// qu'une conversation deja presente dans l'etat local du composant, une fois sa
// propre liste chargee), cette version est autonome -- utilisable depuis
// n'importe quel ecran (ex: bouton "Envoyer un message" sur un profil public)
// sans dependre de MessagerieScreen etant deja monte.
export async function findOrCreateDM(myUserId: string, otherId: string): Promise<string | null> {
  const [{ data: mine }, { data: theirs }] = await Promise.all([
    supabase.from('conversation_members').select('conversation_id').eq('user_id', myUserId),
    supabase.from('conversation_members').select('conversation_id').eq('user_id', otherId),
  ]);
  const mySet = new Set((mine || []).map((r: any) => r.conversation_id));
  const shared = (theirs || []).map((r: any) => r.conversation_id).filter((id: string) => mySet.has(id));
  for (const cid of shared) {
    const { count } = await supabase.from('conversation_members').select('*', { count: 'exact', head: true }).eq('conversation_id', cid);
    if (count === 2) return cid;
  }

  const { data: conv, error } = await supabase.from('conversations')
    .insert({ nom: null, created_by: myUserId, actif: true })
    .select('id').single();
  if (error || !conv) return null;

  await supabase.from('conversation_members').insert([
    { conversation_id: conv.id, user_id: myUserId },
    { conversation_id: conv.id, user_id: otherId },
  ]);
  return conv.id;
}
