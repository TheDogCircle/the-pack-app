import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Phase Pro 7, point 4 : resout thepack.fr/go/<code> -- le _redirects de
// Cloudflare Pages (racine du repo the-pack) renvoie /go/* vers cette
// fonction avec ?code=<code>, qui logue le clic puis redirige (302) vers
// l'URL reelle de la marque. Public, sans auth (c'est un lien partage
// n'importe ou -- email, reseaux sociaux, flyer d'un toiletteur partenaire).
//
// IMPORTANT au deploiement : doit toujours etre deploye avec --no-verify-jwt
// (confirme en testant -- sans ce flag, la plateforme bloque tout appel
// sans JWT avec un 401 avant meme d'atteindre ce code, cassant la
// redirection pour un visiteur anonyme). Pas de config.toml dans ce repo
// pour le fixer de facon declarative -- a rappeler a chaque redeploiement
// de cette fonction precise :
//   supabase functions deploy go-redirect --no-verify-jwt
const FALLBACK_URL = 'https://thepackclub.fr'

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    if (!code) return Response.redirect(FALLBACK_URL, 302)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: codeRow } = await supabaseAdmin
      .from('codes_partenaires').select('org_id, url_destination, actif').eq('code', code).maybeSingle()
    if (!codeRow || !codeRow.actif) return Response.redirect(FALLBACK_URL, 302)

    // Pas de user_id -- un lien /go/<code> est ouvert hors app, sans session
    // Supabase (navigateur, scan QR d'un flyer...). anonymous_id = le code
    // lui-meme fait l'affaire pour distinguer les sources dans les stats
    // d'audience (point 7), pas besoin d'un vrai identifiant de visiteur.
    await supabaseAdmin.from('events').insert({
      event_name: 'code_clic',
      properties: { code, org_id: codeRow.org_id },
      platform: 'web',
      anonymous_id: `go_${code}`,
    })

    let dest = codeRow.url_destination
    if (!/^https?:\/\//i.test(dest)) dest = 'https://' + dest
    return Response.redirect(dest, 302)
  } catch (err) {
    console.error('go-redirect:', err.message)
    return Response.redirect(FALLBACK_URL, 302)
  }
})
