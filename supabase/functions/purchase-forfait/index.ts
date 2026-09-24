import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Achat d'un forfait (plusieurs seances vendues en une fois) : paiement
// immediat classique (capture automatique, pas de demande a valider -- le
// client achete un credit de seances, ce n'est pas une reservation sur un
// creneau precis). La ligne forfaits_achetes n'est creee qu'a la
// confirmation du paiement par le webhook Stripe (payment_intent.succeeded,
// metadata.kind === 'forfait_achat'), pas ici.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' })

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

    const { forfait_id } = await req.json()
    if (!forfait_id) throw new Error('forfait_id manquant')

    const { data: forfait, error: forfaitErr } = await supabaseAdmin
      .from('forfaits').select('id, lieu_id, nb_seances, prix, validite_jours, actif').eq('id', forfait_id).maybeSingle()
    if (forfaitErr) throw forfaitErr
    if (!forfait || !forfait.actif) throw new Error('Forfait introuvable')

    const { data: lieu, error: lieuErr } = await supabaseAdmin
      .from('lieux').select('id, plan, stripe_account_id, stripe_charges_enabled, commission_rate_percent').eq('id', forfait.lieu_id).maybeSingle()
    if (lieuErr) throw lieuErr
    if (!lieu) throw new Error('Lieu introuvable')
    if (!['pro', 'premium'].includes(lieu.plan)) throw new Error("Ce lieu n'a pas accès aux réservations en ligne")
    if (!lieu.stripe_account_id || !lieu.stripe_charges_enabled) {
      throw new Error("Ce prestataire n'a pas encore activé les paiements en ligne")
    }

    let percent = lieu.commission_rate_percent
    if (percent === null || percent === undefined) {
      const { data: settings } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'commission_rate').maybeSingle()
      percent = settings?.value?.percent ?? 20
    }

    const amountCents = Math.round(Number(forfait.prix) * 100)
    const commissionCents = Math.round(amountCents * (percent / 100))

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      payment_method_types: ['card'],
      application_fee_amount: commissionCents,
      transfer_data: { destination: lieu.stripe_account_id },
      metadata: {
        kind: 'forfait_achat',
        forfait_id: forfait.id,
        lieu_id: forfait.lieu_id,
        user_id: caller.id,
        nb_seances: String(forfait.nb_seances),
        prix: String(forfait.prix),
        validite_jours: forfait.validite_jours ? String(forfait.validite_jours) : '',
      },
    })

    return new Response(JSON.stringify({ client_secret: paymentIntent.client_secret }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
