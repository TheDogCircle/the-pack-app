import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Ecrit lieux.google_photo_url pour le compte du visiteur anonyme qui vient de
// declencher un fetch live de la Places API (carte.html) -- RLS interdit a raison
// toute ecriture sur `lieux` par un role non authentifie (un visiteur ne doit pas
// pouvoir reecrire n'importe quel champ d'une fiche). Cette fonction ne fait qu'une
// seule chose, avec un controle strict sur ce qui peut etre ecrit : mettre en cache
// une URL de photo Google deja recuperee, uniquement si aucune n'est deja en cache
// (evite d'ecraser une valeur plus fraiche en cas de requetes concurrentes).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { lieuId, photoUrl } = await req.json();
    if (
      typeof lieuId !== 'string' || !/^[0-9a-f-]{36}$/i.test(lieuId) ||
      typeof photoUrl !== 'string' || !photoUrl.startsWith('https://places.googleapis.com/v1/')
    ) {
      return new Response(JSON.stringify({ error: 'invalid payload' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error } = await supabase
      .from('lieux')
      .update({ google_photo_url: photoUrl })
      .eq('id', lieuId)
      .is('google_photo_url', null);
    if (error) {
      console.log('[cache-lieu-photo] update error:', error.message);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: corsHeaders });
  }
});
