import { supabase } from './supabase';

// Retrouve ou cree une conversation directe (DM) entre l'utilisateur courant et
// otherId. Delegue a la fonction serveur find_or_create_dm (audit de securite) :
// l'ancienne version lisait directement conversation_members.user_id = otherId
// pour trouver un DM existant en commun, ce qui demandait de pouvoir lire les
// appartenances d'un AUTRE utilisateur -- plus possible depuis que la RLS a ete
// correctement activee sur ces tables (elle etait totalement absente avant).
export async function findOrCreateDM(myUserId: string, otherId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('find_or_create_dm', { p_other_id: otherId });
  if (error) return null;
  return data;
}
