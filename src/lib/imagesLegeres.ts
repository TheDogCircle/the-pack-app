import { supabase } from './supabase';

// Photos allegees : les originaux font 3 a 9 Mo (photos de telephone en pleine
// resolution). Cloudflare peut livrer a la volee une version redimensionnee
// (img.thepacklameute.fr/cdn-cgi/image/...), 15 a 25 fois plus legere.
// Interrupteur a distance : app_settings.images_reduites = true, a activer
// seulement une fois les "Transformations" Cloudflare activees sur le domaine
// (sinon ces adresses renvoient une erreur 404). Sans l'interrupteur, rien ne
// change : l'adresse d'origine est utilisee.

const DOMAINE = 'https://img.thepacklameute.fr/';
let actif = false;

export async function chargerReglageImages(): Promise<void> {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'images_reduites').maybeSingle();
    const v = (data as any)?.value;
    actif = v === true || v === 'true';
  } catch {}
}

// largeur en pixels reels (ecran de telephone ~ 400 pt x 2-3)
export function imgL(url: string | null | undefined, largeur = 900): string {
  if (!url) return url as any;
  if (!actif || !url.startsWith(DOMAINE) || url.includes('/cdn-cgi/')) return url;
  return `${DOMAINE}cdn-cgi/image/width=${largeur},quality=75,fit=scale-down,format=auto/${url.slice(DOMAINE.length)}`;
}
