import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Declenche par trg_notify_idee_livree (AFTER UPDATE sur tickets, quand
// idee_statut passe a 'livre'). Notifie tous les votants (idee_votes),
// pas seulement l'auteur de l'idee.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const payload = await req.json()
    const ticket = payload.record
    if (!ticket) return new Response('no record', { status: 200 })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: votes } = await supabaseAdmin.from('idee_votes').select('user_id').eq('ticket_id', ticket.id)
    if (!votes?.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200, headers: CORS })

    const { data: profils } = await supabaseAdmin
      .from('profils').select('push_token').in('id', votes.map(v => v.user_id)).not('push_token', 'is', null)

    let sent = 0
    for (const p of profils || []) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          to: p.push_token,
          title: 'Ton idée a été livrée 🎉',
          body: ticket.subject,
          data: { type: 'idee_livree', ticketId: ticket.id },
          sound: 'default',
          badge: 1,
        }),
      })
      sent++
    }

    return new Response(JSON.stringify({ sent }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
