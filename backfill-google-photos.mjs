// Backfill des photos Google Places pour les lieux sans photo (communauté ni Google)
// Bloqué tant que "Places API (New)" n'est pas activée sur le projet Google Cloud :
//   https://console.developers.google.com/apis/api/places.googleapis.com/overview?project=991716664713
// (nécessite un compte de facturation Google, crédit gratuit mensuel largement suffisant)
//
// Usage :
//   export SUPABASE_SERVICE_KEY="..."
//   node backfill-google-photos.mjs           # lot de test (5 lieux)
//   node backfill-google-photos.mjs --all      # tous les lieux sans photo
//   node backfill-google-photos.mjs --limit=50

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = 'https://rdioupfyinxcmjascmcb.supabase.co';
// Même clé que celle utilisée côté client dans CarteScreen.tsx — passer
// GOOGLE_PLACES_API_KEY en env si elle est restreinte/rotée plus tard.
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyAvVkbdbfvP3Rkp59754kDfhyDYD0xLNvA';

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.error('Variable manquante : SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws },
});

const args = process.argv.slice(2);
const runAll = args.includes('--all');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : (runAll ? 100000 : 5);

async function fetchGooglePhoto(lieu) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.photos',
    },
    body: JSON.stringify({ textQuery: `${lieu.nom} ${lieu.ville} France`, languageCode: 'fr', maxResultCount: 1 }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const photoName = json.places?.[0]?.photos?.[0]?.name;
  if (!photoName) return null;
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${GOOGLE_KEY}`;
}

async function main() {
  console.log(runAll ? '📸 Backfill complet (tous les lieux sans photo)' : `📸 Lot de test (${limit} lieux)`);

  const { data: photoLieuIds } = await sb.from('photos').select('lieu_id').eq('validee', true);
  const hasCommunityPhoto = new Set((photoLieuIds || []).map(p => p.lieu_id));

  const { data: lieux, error } = await sb
    .from('lieux').select('id,nom,ville')
    .eq('actif', true).is('google_photo_url', null);
  if (error) { console.error('Erreur lecture lieux:', error.message); process.exit(1); }

  const todo = (lieux || []).filter(l => !hasCommunityPhoto.has(l.id)).slice(0, limit);
  console.log(`${todo.length} lieu(x) à traiter sur ${lieux?.length ?? 0} sans google_photo_url.\n`);

  let ok = 0, none = 0, failed = 0;
  for (const lieu of todo) {
    try {
      const url = await fetchGooglePhoto(lieu);
      if (!url) { console.log(`  ∅ pas de photo trouvée : ${lieu.nom} (${lieu.ville})`); none++; continue; }
      const check = await fetch(url, { method: 'HEAD' });
      if (!check.ok) { console.log(`  ✗ URL inaccessible (${check.status}) : ${lieu.nom}`); failed++; continue; }
      await sb.from('lieux').update({ google_photo_url: url }).eq('id', lieu.id);
      console.log(`  ✔ ${lieu.nom} (${lieu.ville})`);
      ok++;
    } catch (e) {
      console.log(`  ✗ ${lieu.nom} : ${e.message}`);
      failed++;
    }
    // Respecte les quotas Google — pas de rafale
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n✅ Terminé : ${ok} photo(s) ajoutée(s), ${none} sans résultat, ${failed} échec(s).`);
}

main().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
