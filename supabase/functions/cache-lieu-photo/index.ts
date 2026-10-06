import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Recupere UNE fois la photo Google Places d'un lieu et la re-heberge dans le
// bucket Storage `lieu-photos` -- au lieu de mettre en cache une URL Google
// vivante (l'ancienne version de cette fonction), qui refacturait Google a
// CHAQUE visiteur qui chargeait la fiche ensuite. Ici, apres ce premier appel,
// toutes les visites suivantes de la fiche servent l'image depuis notre propre
// Storage : plus aucun cout Google recurrent, quel que soit le trafic.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { lieuId, photoName, noPhoto } = await req.json();
    if (typeof lieuId !== 'string' || !/^[0-9a-f-]{36}$/i.test(lieuId)) {
      return new Response(JSON.stringify({ error: 'invalid payload' }), { status: 400, headers: corsHeaders });
    }
    if (
      !noPhoto &&
      (typeof photoName !== 'string' || !/^places\/[^/]+\/photos\/[^/]+$/.test(photoName))
    ) {
      return new Response(JSON.stringify({ error: 'invalid payload' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Si deja en cache (course entre deux visiteurs simultanes, ou rejoue),
    // on ne refait ni l'appel Google ni l'upload. 'none' = deja verifie, ce
    // lieu n'a pas de photo Google -- vaut aussi bien qu'une URL pour arreter
    // toute nouvelle recherche.
    const { data: existing } = await supabase.from('lieux').select('google_photo_url').eq('id', lieuId).maybeSingle();
    if (existing?.google_photo_url) {
      return new Response(JSON.stringify({ ok: true, url: existing.google_photo_url, cached: true }), { headers: corsHeaders });
    }

    if (noPhoto) {
      // Marque definitivement "pas de photo Google pour ce lieu" -- sans ca,
      // chaque visiteur qui ouvre une fiche sans photo relancait une recherche
      // Text Search (facturee, tarif "Pro" a cause du champ photos) a l'infini,
      // meme quand la reponse est toujours "rien trouve".
      await supabase.from('lieux').update({ google_photo_url: 'none' }).eq('id', lieuId).is('google_photo_url', null);
      return new Response(JSON.stringify({ ok: true, url: null, cached: false }), { headers: corsHeaders });
    }

    const googleKey = Deno.env.get('GOOGLE_PLACES_KEY');
    if (!googleKey) throw new Error('GOOGLE_PLACES_KEY non configuree');

    const mediaRes = await fetch(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=900&key=${googleKey}`);
    if (!mediaRes.ok) throw new Error(`Google media fetch echoue : ${mediaRes.status}`);
    const contentType = mediaRes.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const bytes = new Uint8Array(await mediaRes.arrayBuffer());

    const path = `google-cache/${lieuId}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('lieu-photos').upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('lieu-photos').getPublicUrl(path);

    // Guard .is(...) : si un autre visiteur a gagne la course entre-temps, on
    // garde sa valeur plutot que d'ecraser (les deux images sont equivalentes
    // de toute facon, meme lieu, meme recherche Google).
    await supabase.from('lieux').update({ google_photo_url: publicUrl }).eq('id', lieuId).is('google_photo_url', null);

    return new Response(JSON.stringify({ ok: true, url: publicUrl, cached: false }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: corsHeaders });
  }
});
