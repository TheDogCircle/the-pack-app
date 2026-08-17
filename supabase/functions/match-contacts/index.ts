import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Meme logique que src/lib/phone.ts cote app — ne garde que les 9 derniers
// chiffres pour comparer un numero quel que soit son format d'origine.
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 9) return null
  return digits.slice(-9)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Non autorisé')
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !caller) throw new Error('Non autorisé')

    const { phones } = await req.json()
    if (!Array.isArray(phones) || !phones.length) {
      return new Response(JSON.stringify({ matches: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    // Les numeros envoyes par le client sont deja normalises (lib/phone.ts),
    // mais on re-normalise cote serveur par prudence (defense en profondeur).
    const wanted = new Set(phones.map((p: string) => normalizePhone(String(p))).filter(Boolean))
    if (!wanted.size) {
      return new Response(JSON.stringify({ matches: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const { data: candidates, error: qErr } = await supabaseAdmin
      .from('profils')
      .select('id, prenom, avatar_url, ville, telephone')
      .not('telephone', 'is', null)
      .neq('id', caller.id)
    if (qErr) throw qErr

    const matches = (candidates || [])
      .filter(c => c.telephone && wanted.has(normalizePhone(c.telephone)))
      .map(c => ({ id: c.id, prenom: c.prenom, avatar_url: c.avatar_url, ville: c.ville }))

    return new Response(JSON.stringify({ matches }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
