import AsyncStorage from '@react-native-async-storage/async-storage';

// Memoire locale des ecrans (affichage immediat puis mise a jour en arriere-plan,
// comme Instagram) : chaque ecran affiche ce qu'il avait charge la derniere fois
// pendant que la requete reseau tourne, au lieu d'un rond de chargement.
// - Cles par utilisateur (jamais les donnees d'un autre compte apres changement).
// - Taille plafonnee : au-dela, on n'ecrit pas (AsyncStorage Android ~6 Mo).
// - Toute erreur est ignoree : sans cache, l'ecran se comporte comme avant.

const PREFIXE = 'cache_ecran_v1:';
const TAILLE_MAX = 400_000;
const AGE_MAX_MS = 7 * 86400000;

export async function lireCache<T>(cle: string): Promise<T | null> {
  try {
    const brut = await AsyncStorage.getItem(PREFIXE + cle);
    if (!brut) return null;
    const { t, v } = JSON.parse(brut);
    if (typeof t !== 'number' || Date.now() - t > AGE_MAX_MS) return null;
    return v as T;
  } catch {
    return null;
  }
}

export function ecrireCache(cle: string, valeur: unknown): void {
  try {
    const brut = JSON.stringify({ t: Date.now(), v: valeur });
    if (brut.length > TAILLE_MAX) return;
    AsyncStorage.setItem(PREFIXE + cle, brut).catch(() => {});
  } catch {}
}
