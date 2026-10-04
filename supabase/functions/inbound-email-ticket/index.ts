import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// PREPARATION, pas encore branche en prod (demande explicite de Marine :
// "prevois l'import"). Pour que ca recoive vraiment des emails il faut,
// cote Marine : un enregistrement MX chez l'hebergeur DNS pointant vers
// Resend + activation de l'inbound parsing dans le dashboard Resend, qui
// donnera l'URL de ce webhook a configurer. Aucun de ces deux reglages
// n'est fait depuis cet environnement.
//
// Incertitude assumee : je n'ai pas de payload reel d'un webhook inbound
// Resend sous la main pour verifier le format exact des champs ci-dessous
// (from/subject/text) -- mappage fait sur la base du format usuel des
// webhooks email (Postmark/SendGrid/Resend se ressemblent), A VERIFIER et
// ajuster avec un vrai payload de test une fois l'inbound active.
//
// Securite (trouve en recette) : cette fonction est deja deployee et donc
// deja joignable publiquement des maintenant, meme si rien n'y pointe
// encore cote Resend -- n'importe qui connaissant l'URL pouvait creer des
// tickets arbitraires, y compris en usurpant l'email "from" pour les
// rattacher au compte d'un vrai utilisateur. Protege par un secret partage
// (INBOUND_EMAIL_SECRET) a definir dans les secrets du projet Supabase et
// a configurer comme parametre de l'URL webhook cote Resend quand l'inbound
// sera active. Si Resend fournit un vrai mecanisme de signature a ce
// moment-la, le remplacer par une verification de signature plutot que ce
// secret statique.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const expectedSecret = Deno.env.get('INBOUND_EMAIL_SECRET')
    const providedSecret = new URL(req.url).searchParams.get('secret') ?? req.headers.get('x-webhook-secret')
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Non autorisé' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const payload = await req.json()
    console.log('[inbound-email-ticket] payload recu:', JSON.stringify(payload).slice(0, 2000))

    const fromEmail: string | undefined = payload.from?.email || payload.from
    const subject: string = payload.subject || '(sans objet)'
    const text: string = payload.text || payload.html || ''

    if (!fromEmail) {
      return new Response(JSON.stringify({ skipped: 'no from email in payload' }), { status: 200, headers: CORS })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Rattache au compte existant si l'email correspond a un utilisateur
    // connu (auth.users), sinon ticket sans requester_id -- un admin pourra
    // quand meme repondre par email en dehors du flux normal pour l'instant.
    // Meme limite connue que lookup-user (Phase 0) : listUsers() ne pagine
    // pas au-dela de perPage, un email au-dela de cette limite ne sera pas
    // retrouve -- acceptable pour l'instant (fonction non branchee), a
    // revoir si la base d'utilisateurs grandit avant que ce soit active.
    const { data: authUser } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    const matchedUser = authUser?.users?.find(u => u.email?.toLowerCase() === fromEmail.toLowerCase())

    const { data: ticket, error } = await supabaseAdmin.from('tickets').insert({
      type: 'question',
      source: 'email',
      requester_id: matchedUser?.id ?? null,
      subject: subject.slice(0, 200),
      platform: null,
    }).select('id').single()
    if (error) throw error

    await supabaseAdmin.from('ticket_messages').insert({
      ticket_id: ticket.id,
      auteur_id: matchedUser?.id ?? null,
      visibilite: 'client',
      contenu: `[Email reçu de ${fromEmail}]\n\n${text}`,
    })

    return new Response(JSON.stringify({ created: true, ticket_id: ticket.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
