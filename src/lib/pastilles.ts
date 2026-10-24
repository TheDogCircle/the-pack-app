import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Preference "pastilles rouges sur les onglets" (barre du bas, coeur d'activite,
// onglets Feed / Messages / Membres). Stockee sur le telephone ; activee par defaut.
const CLE = 'thepack_pref_pastilles';
let valeur = true;
let charge = false;
const abonnes = new Set<(v: boolean) => void>();

AsyncStorage.getItem(CLE).then(v => {
  charge = true;
  if (v === '0') { valeur = false; abonnes.forEach(cb => cb(false)); }
}).catch(() => { charge = true; });

export function setPastillesActives(v: boolean) {
  valeur = v;
  abonnes.forEach(cb => cb(v));
  AsyncStorage.setItem(CLE, v ? '1' : '0').catch(() => {});
}

export function usePastillesActives(): boolean {
  const [v, setV] = useState(valeur);
  useEffect(() => {
    abonnes.add(setV);
    if (charge) setV(valeur);
    return () => { abonnes.delete(setV); };
  }, []);
  return v;
}
