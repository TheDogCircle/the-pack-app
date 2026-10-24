import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Remplace l'ecriture directe sb.from('lieux').update({plan}) que faisait
// espace-pro.html (choosePlan()) : policy RLS pro_can_update_own_lieu
// autorisait le gerant a modifier N'IMPORTE QUELLE colonne de sa fiche, pas
// juste plan -- un pro pouvait deja s'auto-attribuer Premium gratuitement,
// falsifier son statut SIRET/KBIS ou son abonnement Stripe. Corrige par un
// trigger admin-only sur lieux/organizations (migration
// 20261013200000) qui bloque desormais cette ecriture directe.
//
// Decision de Marine (2026-10-13) : en attendant le vrai webhook Stripe
// (pas encore branche sur un lien de paiement reel), le changement de
// forfait reste instantane cote pro -- aucune verification de paiement
// ici non plus -- mais passe maintenant par cette fonction de confiance
// (service role) plutot que par une requete que le navigateur du pro
// pourrait manipuler. Ne cree volontairement PAS de ligne revenue_events :
// aucun paiement reel n'est verifie, un evenement de "revenu" ici serait
// trompeur pour les rapports financiers.
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

    const { lieu_id, plan } = await req.json()
    if (!lieu_id || !plan) throw new Error('lieu_id et plan requis')
    if (!['decouverte', 'essentiel', 'premium'].includes(plan)) throw new Error('plan invalide')
    // Decision de Marine (2026-10-25) : fin de l'activation gratuite. Essentiel /
    // Premium ne s'activent plus que par le paiement Stripe (lien d'abonnement,
    // client_reference_id = lieu, puis stripe-webhook checkout.session.completed).
    // Cette fonction ne sert plus qu'a revenir a la formule gratuite.
    if (plan !== 'decouverte') throw new Error('Cette formule s\'active après paiement : utilisez le bouton « S\'abonner ».')

    const { data: lieu, error: lieuErr } = await supabaseAdmin
      .from('lieux').select('id, manager_user_id').eq('id', lieu_id).maybeSingle()
    if (lieuErr) throw lieuErr
    if (!lieu) throw new Error('Lieu introuvable')

    // Trouve l'organisation liee (via org_places), pour verifier l'acces
    // owner/manager meme pour un membre staff qui n'est pas manager_user_id
    // direct, et pour garder organizations.plan synchronise.
    const { data: place } = await supabaseAdmin
      .from('org_places').select('org_id').eq('lieu_id', lieu_id).eq('statut', 'approved').maybeSingle()

    let authorized = lieu.manager_user_id === caller.id
    if (!authorized && place?.org_id) {
      const { data: membership } = await supabaseAdmin
        .from('org_members').select('role').eq('org_id', place.org_id).eq('user_id', caller.id).eq('status', 'active').maybeSingle()
      authorized = membership?.role === 'owner' || membership?.role === 'manager'
    }
    if (!authorized) throw new Error('Non autorisé sur ce lieu')

    const { error: updateLieuErr } = await supabaseAdmin.from('lieux').update({ plan }).eq('id', lieu_id)
    if (updateLieuErr) throw updateLieuErr

    if (place?.org_id) {
      const { error: updateOrgErr } = await supabaseAdmin.from('organizations').update({ plan }).eq('id', place.org_id)
      if (updateOrgErr) throw updateOrgErr
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
