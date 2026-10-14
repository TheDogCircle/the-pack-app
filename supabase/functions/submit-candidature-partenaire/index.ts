import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Audit de securite (2026-10-14) : partenaires.html inserait directement
// dans candidatures_partenaires en tant que visiteur anonyme (policy RLS
// "Anyone can submit candidature", WITH CHECK true, deja correcte et
// verifiee en SQL direct) -- mais l'API REST publique refusait cet insert
// precis pour une raison jamais identifiee cote plateforme (grants/policy/
// absence de trigger tous confirmes corrects en SQL, meme apres
// redemarrage complet du projet et recreation de la policy). Contourne en
// passant par une edge function (service role, comme submit-devis-request)
// plutot que de dependre du chemin REST-direct casse pour cette table
// precise. Deploye avec --no-verify-jwt (visiteur anonyme, meme raison que
// go-redirect).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { nom_marque, contact_nom, email, telephone, categorie, description, site_web } = await req.json()
    if (!nom_marque?.trim() || !contact_nom?.trim() || !email?.trim()) {
      throw new Error('nom_marque, contact_nom et email sont requis')
    }

    const { error: insertErr } = await supabaseAdmin.from('candidatures_partenaires').insert({
      nom_marque: nom_marque.trim(),
      contact_nom: contact_nom.trim(),
      email: email.trim(),
      telephone: telephone?.trim() || null,
      categorie: categorie || null,
      description: description?.trim() || null,
      site_web: site_web?.trim() || null,
    })
    if (insertErr) throw insertErr

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
