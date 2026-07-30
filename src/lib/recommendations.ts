import { supabase } from './supabase';

// Signaux de personnalisation calculés pour un utilisateur donné.
// Alimentent le score de chaque lieu dans les rangées "Recommandé pour toi"
// et "Les coups de cœur de tes amis" du mode Liste de la carte.
export type UserSignals = {
  categoryAffinity: Record<string, number>; // cat -> poids 0..1
  ownFavoriteLieuIds: Set<string>;
  friendPickLieuIds: Set<string>; // favori ou avis >=4 par une personne suivie
};

const EMPTY_SIGNALS: UserSignals = {
  categoryAffinity: {},
  ownFavoriteLieuIds: new Set(),
  friendPickLieuIds: new Set(),
};

export async function loadUserSignals(userId: string | null): Promise<UserSignals> {
  if (!userId) return EMPTY_SIGNALS;

  // avis.lieu_id est de type text (pas de FK vers lieux.id) : impossible d'utiliser
  // l'embed PostgREST comme pour favoris, on joint la catégorie manuellement.
  const [{ data: ownFavoris }, { data: ownAvis }, { data: followsRows }] = await Promise.all([
    supabase.from('favoris').select('lieu_id, lieux(cat)').eq('user_id', userId),
    supabase.from('avis').select('lieu_id, note').eq('user_id', userId).gte('note', 4),
    supabase.from('follows').select('following_id').eq('follower_id', userId).eq('statut', 'accepte'),
  ]);

  const ownFavoriteLieuIds = new Set<string>((ownFavoris || []).map((f: any) => f.lieu_id));

  const catCounts: Record<string, number> = {};
  const bumpCat = (cat?: string | null) => { if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1; };
  (ownFavoris || []).forEach((f: any) => bumpCat(f.lieux?.cat));

  const avisLieuIds = [...new Set((ownAvis || []).map((a: any) => a.lieu_id))];
  if (avisLieuIds.length) {
    const { data: avisLieux } = await supabase.from('lieux').select('id,cat').in('id', avisLieuIds);
    const catByLieu: Record<string, string> = {};
    (avisLieux || []).forEach((l: any) => { catByLieu[l.id] = l.cat; });
    (ownAvis || []).forEach((a: any) => bumpCat(catByLieu[a.lieu_id]));
  }
  const maxCount = Math.max(1, ...Object.values(catCounts));
  const categoryAffinity: Record<string, number> = {};
  Object.entries(catCounts).forEach(([cat, count]) => { categoryAffinity[cat] = count / maxCount; });

  const friendIds = (followsRows || []).map((f: any) => f.following_id);
  const friendPickLieuIds = new Set<string>();
  if (friendIds.length) {
    const [{ data: friendFavoris }, { data: friendAvis }] = await Promise.all([
      supabase.from('favoris').select('lieu_id').in('user_id', friendIds),
      supabase.from('avis').select('lieu_id').in('user_id', friendIds).gte('note', 4),
    ]);
    (friendFavoris || []).forEach((f: any) => friendPickLieuIds.add(f.lieu_id));
    (friendAvis || []).forEach((a: any) => friendPickLieuIds.add(a.lieu_id));
  }

  return { categoryAffinity, ownFavoriteLieuIds, friendPickLieuIds };
}

export type ScorableLieu = {
  id: string;
  cat: string;
  note_moyenne?: number | null;
  nb_avis?: number | null;
  created_at?: string | null;
  mise_en_avant?: boolean | null;
  distance?: number; // km, optionnel
};

const QUALITY_PRIOR = 3.8; // note moyenne globale supposée, amortit les lieux à 1-2 avis
const QUALITY_MIN_VOTES = 5;
const MAX_PROXIMITY_KM = 15;
const FRESH_DAYS = 30;

function qualityScore(lieu: ScorableLieu): number {
  const n = lieu.nb_avis || 0;
  const avg = lieu.note_moyenne || 0;
  const bayesian = (avg * n + QUALITY_PRIOR * QUALITY_MIN_VOTES) / (n + QUALITY_MIN_VOTES);
  return Math.max(0, Math.min(1, bayesian / 5));
}

function proximityScore(lieu: ScorableLieu): number {
  if (lieu.distance == null) return 0.5; // pas de position connue: neutre
  return Math.max(0, 1 - lieu.distance / MAX_PROXIMITY_KM);
}

function freshnessScore(lieu: ScorableLieu): number {
  if (lieu.mise_en_avant) return 1;
  if (!lieu.created_at) return 0;
  const ageDays = (Date.now() - new Date(lieu.created_at).getTime()) / 86400000;
  return ageDays <= FRESH_DAYS ? 1 - ageDays / FRESH_DAYS * 0.5 : 0;
}

export function scoreLieu(lieu: ScorableLieu, signals: UserSignals): number {
  const affinity = signals.categoryAffinity[lieu.cat] || 0;
  const friendBoost = signals.friendPickLieuIds.has(lieu.id) ? 1 : 0;
  return (
    0.30 * affinity +
    0.25 * friendBoost +
    0.20 * qualityScore(lieu) +
    0.15 * proximityScore(lieu) +
    0.10 * freshnessScore(lieu)
  );
}

// Classement "Recommandé pour toi": exclut ce que l'utilisateur a déjà favori
// (on découvre, on ne re-montre pas l'acquis), trie par score décroissant.
export function rankForYou<T extends ScorableLieu>(lieux: T[], signals: UserSignals, limit = 10): T[] {
  return lieux
    .filter(l => !signals.ownFavoriteLieuIds.has(l.id))
    .map(l => ({ lieu: l, score: scoreLieu(l, signals) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.lieu);
}

export function filterFriendPicks<T extends ScorableLieu>(lieux: T[], signals: UserSignals, limit = 10): T[] {
  return lieux.filter(l => signals.friendPickLieuIds.has(l.id)).slice(0, limit);
}
