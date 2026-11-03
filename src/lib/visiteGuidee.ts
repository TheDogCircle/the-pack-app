// Permet de rouvrir la visite guidee depuis n'importe quel ecran (Reglages).
type Ecouteur = () => void;
let ecouteur: Ecouteur | null = null;

export const visiteGuidee = {
  ouvrir() { ecouteur?.(); },
  ecouter(cb: Ecouteur | null) { ecouteur = cb; },
};

// Destinations des boutons "Y aller" (geres par la navigation principale)
export type CibleVisite = 'carte' | 'balade' | 'classement' | 'meute' | 'messages' | 'events' | 'partenaires' | 'profil';
