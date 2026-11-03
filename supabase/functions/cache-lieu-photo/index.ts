import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Recupere UNE fois la photo Google Places d'un lieu et la re-heberge dans le
// bucket Storage `lieu-photos`. Ensuite toutes les visites de la fiche (app et
// site) servent l'image depuis notre Storage : plus aucun cout Google.
//
// Appels possibles :
//   { lieuId }               -> si le lieu a encore un lien Google "vivant" en
//                               base, on recupere cette photo et on la re-heberge
//   { lieuId, photoName }    -> photo trouvee par une recherche (lieu jamais
//                               cherche, ou lien Google expire)
//   { lieuId, noPhoto: true }-> Google n'a pas de photo : on note 'none'
// Reponse : { ok, url } (url = notre Storage, ou null) ou { error, expire? }.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PLAFOND_JOUR = 150;
const LIEN_GOOGLE = /^https:\/\/places\.googleapis\.com\/v1\/(places\/[^/]+\/photos\/[^/?]+)\/media/;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { lieuId, photoName, noPhoto } = await req.json();
    if (typeof lieuId !== 'string' || !/^[0-9a-f-]{36}$/i.test(lieuId)) return json({ error: 'invalid payload' }, 400);
    if (photoName != null && (typeof photoName !== 'string' || !/^places\/[^/]+\/photos\/[^/]+$/.test(photoName))) {
      return json({ error: 'invalid payload' }, 400);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: lieu } = await supabase.from('lieux').select('google_photo_url').eq('id', lieuId).maybeSingle();
    if (!lieu) return json({ error: 'introuvable' }, 404);
    const actuel: string | null = lieu.google_photo_url;
    const actuelGoogle = !!actuel && LIEN_GOOGLE.test(actuel);

    // Deja chez nous (ou deja verifie sans photo) : rien a faire, zero cout
    if (actuel && !actuelGoogle) return json({ ok: true, url: actuel === 'none' ? null : actuel, cached: true });

    if (noPhoto) {
      if (!actuel) await supabase.from('lieux').update({ google_photo_url: 'none' }).eq('id', lieuId).is('google_photo_url', null);
      return json({ ok: true, url: null });
    }

    // Plafond de depense : au plus PLAFOND_JOUR photos Google recopiees par jour
    // (~0,6 centime chacune). Au-dela, pas de photo aujourd'hui, on reessaiera
    // demain : le client affiche l'icone de la categorie.
    const { data: recentes } = await supabase.storage.from('lieu-photos')
      .list('google-cache', { limit: PLAFOND_JOUR + 1, sortBy: { column: 'created_at', order: 'desc' } });
    const minuit = new Date(); minuit.setUTCHours(0, 0, 0, 0);
    const aujourdhui = (recentes || []).filter((f: any) => f.created_at && new Date(f.created_at) >= minuit).length;
    if (aujourdhui >= PLAFOND_JOUR) return json({ ok: true, url: null, plafond: true });

    // Photo a recuperer : celle donnee par la recherche, sinon celle du lien en base
    const nom = photoName || (actuelGoogle ? actuel!.match(LIEN_GOOGLE)![1] : null);
    if (!nom) return json({ ok: true, url: null, aChercher: true });

    const googleKey = Deno.env.get('GOOGLE_PLACES_KEY');
    if (!googleKey) throw new Error('GOOGLE_PLACES_KEY non configuree');

    const mediaRes = await fetch(`https://places.googleapis.com/v1/${nom}/media?maxWidthPx=900&key=${googleKey}`);
    if (!mediaRes.ok) {
      // Reference expiree : le client peut relancer une recherche puis rappeler avec photoName
      return json({ error: `Google ${mediaRes.status}`, expire: true }, 200);
    }
    const contentType = mediaRes.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const bytes = new Uint8Array(await mediaRes.arrayBuffer());

    const path = `google-cache/${lieuId}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('lieu-photos').upload(path, bytes, { contentType, upsert: true });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('lieu-photos').getPublicUrl(path);

    // Ne remplace que l'etat lu au debut (pas de course avec un autre visiteur)
    const maj = supabase.from('lieux').update({ google_photo_url: publicUrl }).eq('id', lieuId);
    await (actuel ? maj.eq('google_photo_url', actuel) : maj.is('google_photo_url', null));

    return json({ ok: true, url: publicUrl, cached: false });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
