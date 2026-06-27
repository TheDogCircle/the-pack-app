import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { query, userLat, userLng } = await req.json();
    if (!query?.trim()) return new Response(JSON.stringify({ results: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let dbQuery = supabase
      .from('lieux')
      .select('id,nom,cat,ville,adresse,description,lat,lng,eau,gamelles,chiens_salle,chiens_terrasse,espace_dedie,chiens_laches,chiens_laisse,petits_chiens,moyens_chiens,grands_chiens,note_moyenne,nb_avis')
      .eq('actif', true);

    if (userLat && userLng) {
      const delta = 0.2; // ~22km
      dbQuery = dbQuery
        .gte('lat', userLat - delta).lte('lat', userLat + delta)
        .gte('lng', userLng - delta).lte('lng', userLng + delta);
    }

    const { data: lieux } = await dbQuery.limit(100);
    if (!lieux?.length) return new Response(JSON.stringify({ results: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    const CAT_LABELS: Record<string, string> = {
      restaurant: 'Restaurant', cafe: 'Café', parc: 'Parc', parc_chien: 'Espace canin',
      plage: 'Plage', veto: 'Vétérinaire', toiletteur: 'Toiletteur',
      boutique: 'Boutique', hotel: 'Hôtel', bar: 'Bar', autre: 'Autre',
    };

    const lieuxText = lieux.map((l, i) => {
      const tags = [
        l.eau && 'eau',
        l.gamelles && 'gamelles',
        l.chiens_salle && 'en salle',
        l.chiens_terrasse && 'en terrasse',
        l.espace_dedie && 'espace dédié',
        l.chiens_laches && 'lâchés OK',
        l.chiens_laisse && 'laisse obligatoire',
        l.petits_chiens && 'petits chiens',
        l.moyens_chiens && 'moyens chiens',
        l.grands_chiens && 'grands chiens',
      ].filter(Boolean).join(', ');
      return `${i + 1}. [${l.id}] ${l.nom} — ${CAT_LABELS[l.cat] || l.cat} — ${l.adresse ? l.adresse + ', ' : ''}${l.ville}${l.description ? ' — ' + l.description.slice(0, 120) : ''}${tags ? ' — ' + tags : ''}${l.note_moyenne ? ` — ${l.note_moyenne}/5` : ''}`;
    }).join('\n');

    const prompt = `Tu es un assistant pour une application dog-friendly française appelée The Pack. Un utilisateur cherche : "${query.trim()}"

Voici les lieux dog-friendly disponibles à proximité :
${lieuxText}

Sélectionne les 3 à 5 lieux qui correspondent le mieux à la recherche. Réponds UNIQUEMENT avec un JSON valide, sans aucun texte avant ou après :
{"results":[{"id":"uuid-exact","raison":"explication courte en français (max 12 mots)"}]}

Si aucun lieu ne correspond, réponds : {"results":[]}`;

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiResp.json();
    const text = aiData.content?.[0]?.text?.trim() || '{"results":[]}';

    let parsed: { results: { id: string; raison: string }[] } = { results: [] };
    try { parsed = JSON.parse(text); } catch { /* keep empty */ }

    // Enrich with full lieu data
    const idSet = new Set(parsed.results.map(r => r.id));
    const enriched = parsed.results
      .map(r => {
        const lieu = lieux.find(l => l.id === r.id);
        if (!lieu) return null;
        return { lieu, raison: r.raison };
      })
      .filter(Boolean);

    return new Response(JSON.stringify({ results: enriched }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ results: [], error: String(e) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
