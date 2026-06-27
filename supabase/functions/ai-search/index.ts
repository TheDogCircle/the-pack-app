import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Compact category abbreviations to save tokens
const CAT: Record<string, string> = {
  restaurant: 'resto', cafe: 'café', parc: 'parc', parc_chien: 'canin',
  plage: 'plage', veto: 'véto', toiletteur: 'toilett.', boutique: 'boutique',
  hotel: 'hôtel', bar: 'bar', autre: 'lieu',
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
      .select('id,nom,cat,ville,description,eau,chiens_salle,chiens_terrasse,chiens_laches,petits_chiens,moyens_chiens,grands_chiens,note_moyenne')
      .eq('actif', true);

    if (userLat && userLng) {
      const delta = 0.15; // ~16km
      dbQuery = dbQuery
        .gte('lat', userLat - delta).lte('lat', userLat + delta)
        .gte('lng', userLng - delta).lte('lng', userLng + delta);
    }

    const { data: lieux } = await dbQuery.limit(40);
    if (!lieux?.length) return new Response(JSON.stringify({ results: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    // Ultra-compact format: one line per lieu, only useful fields
    const lieuxText = lieux.map((l, i) => {
      const tags: string[] = [];
      if (l.eau) tags.push('eau');
      if (l.chiens_salle) tags.push('salle');
      if (l.chiens_terrasse) tags.push('terrasse');
      if (l.chiens_laches) tags.push('lâchés');
      if (l.petits_chiens) tags.push('petits');
      if (l.moyens_chiens) tags.push('moyens');
      if (l.grands_chiens) tags.push('grands');
      const desc = l.description ? l.description.slice(0, 60) : '';
      const note = l.note_moyenne ? `★${l.note_moyenne}` : '';
      return `${i + 1}|${l.id}|${l.nom}|${CAT[l.cat] || l.cat}|${l.ville}|${desc}|${tags.join(',')}|${note}`;
    }).join('\n');

    const prompt = `Tu es un assistant pour une app dog-friendly française. Recherche utilisateur: "${query.trim()}"

Lieux disponibles (format: #|id|nom|type|ville|description|équipements|note):
${lieuxText}

Sélectionne 3-4 lieux qui correspondent. Réponds UNIQUEMENT avec ce JSON valide:
{"results":[{"id":"uuid","raison":"explication courte"}]}
Si aucun résultat: {"results":[]}`;

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiResp.json();
    console.log('AI response:', JSON.stringify(aiData));
    const text = aiData.content?.[0]?.text?.trim() || '{"results":[]}';
    console.log('AI text:', text);

    let parsed: { results: { id: string; raison: string }[] } = { results: [] };
    try { parsed = JSON.parse(text); } catch (e) { console.log('Parse error:', e); }

    const enriched = (parsed.results || [])
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
