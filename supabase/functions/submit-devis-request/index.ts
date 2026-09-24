import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTrackedPush } from '../_shared/pushTracking.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Demande de devis a un promeneur/educateur (services souvent negocies par
// telephone, pas de tarif fixe affiche) -- simple prise de contact, resolue
// hors plateforme par le prestataire. Insere la demande et le notifie.
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

    const { lieu_id, chien_id, client_prenom, client_tel, message } = await req.json()
    if (!lieu_id || !client_prenom) throw new Error('Champs manquants')

    const { data: lieu, error: lieuErr } = await supabaseAdmin
      .from('lieux').select('id, nom, manager_user_id').eq('id', lieu_id).maybeSingle()
    if (lieuErr) throw lieuErr
    if (!lieu) throw new Error('Prestataire introuvable')

    const { data: demande, error: insertErr } = await supabaseAdmin
      .from('demandes_devis_presta')
      .insert({
        lieu_id, user_id: caller.id, chien_id: chien_id || null,
        client_prenom, client_tel: client_tel || null, message: message || null,
      })
      .select('id').single()
    if (insertErr) throw insertErr

    if (lieu.manager_user_id) {
      const { data: profil } = await supabaseAdmin.from('profils').select('push_token').eq('id', lieu.manager_user_id).maybeSingle()
      if (profil?.push_token) {
        await sendTrackedPush(supabaseAdmin, {
          type: 'new_reservation',
          lieuId: lieu_id,
          targetId: demande.id,
          title: `Demande de devis — ${client_prenom}`,
          body: message ? message.slice(0, 100) : 'Nouvelle demande de devis, à rappeler.',
          recipients: [{ push_token: profil.push_token }],
          extraData: { demandeDevisId: demande.id, lieuId: lieu_id },
        })
      }
    }

    return new Response(JSON.stringify({ demande_id: demande.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
