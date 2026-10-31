import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';

// Nombre de conversations non lues, partage par la bulle de l'en-tete et l'ecran
// Messages. Meme regle que la liste des discussions : message d'un autre membre plus
// recent que ma derniere lecture (conversation_members.last_read_at), 14 jours maximum.

const NON_LU_MAX_AGE_MS = 14 * 86400000;
let valeur = 0;
const abonnes = new Set<(n: number) => void>();
let canal: any = null;
let canalUser: string | null = null;
let minuterie: any = null;

export function setNonLus(n: number) {
  if (n === valeur) return;
  valeur = n;
  abonnes.forEach(cb => cb(n));
}

export async function rafraichirNonLus() {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) { setNonLus(0); return; }
  const { data: rows } = await supabase.from('conversation_members')
    .select('conversation_id,last_read_at').eq('user_id', uid);
  if (!rows?.length) { setNonLus(0); return; }
  const plancher = Date.now() - NON_LU_MAX_AGE_MS;
  const luDepuis: Record<string, number> = {};
  rows.forEach((r: any) => {
    const t = r.last_read_at ? Date.parse(r.last_read_at) : NaN;
    luDepuis[r.conversation_id] = Number.isFinite(t) && t > plancher ? t : plancher;
  });
  const ids = Object.keys(luDepuis);
  const [{ data: actives }, { data: msgs }] = await Promise.all([
    supabase.from('conversations').select('id').in('id', ids).eq('actif', true),
    supabase.from('messages').select('conversation_id,created_at')
      .in('conversation_id', ids).eq('actif', true).neq('user_id', uid)
      .gt('created_at', new Date(plancher).toISOString())
      .order('created_at', { ascending: false }).limit(500),
  ]);
  const actifs = new Set((actives || []).map((c: any) => c.id));
  const nonLues = new Set<string>();
  (msgs || []).forEach((m: any) => {
    if (actifs.has(m.conversation_id) && Date.parse(m.created_at) > luDepuis[m.conversation_id]) nonLues.add(m.conversation_id);
  });
  setNonLus(nonLues.size);
}

function planifierRafraichissement() {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => { rafraichirNonLus().catch(() => {}); }, 800);
}

function brancherCanal(uid: string | null) {
  if (canalUser === uid) return;
  if (canal) { supabase.removeChannel(canal); canal = null; }
  canalUser = uid;
  if (!uid) return;
  // Nouveau message d'un autre membre dans une de mes conversations (RLS Realtime)
  canal = supabase.channel(`nonlus:${uid}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      if ((payload.new as any)?.user_id !== uid) planifierRafraichissement();
    })
    .subscribe();
}

export function useNonLus(userId: string | null): number {
  const [n, setN] = useState(valeur);
  useEffect(() => {
    abonnes.add(setN);
    setN(valeur);
    return () => { abonnes.delete(setN); };
  }, []);
  useEffect(() => {
    brancherCanal(userId);
    if (!userId) { setNonLus(0); return; }
    rafraichirNonLus().catch(() => {});
    const sub = AppState.addEventListener('change', s => { if (s === 'active') planifierRafraichissement(); });
    return () => sub.remove();
  }, [userId]);
  return n;
}
