import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Deuxieme etape du panier : une fois le premier paiement du panier confirme
// (cf. create-cart-reservations), la carte du client est enregistree sur son
// Stripe Customer. On l'utilise ici hors-session pour autoriser (pas
// debiter -- capture_method manual, comme le reste du flux) chacune des
// prestations restantes, sans que le client ait besoin de resaisir sa carte.
// Un echec sur une ligne (ex: authentification forte requise, impossible
// hors-session) n'annule pas les autres -- chaque ligne est traitee et
// rapportee independamment.
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

    const { first_reservation_id, pending_reservation_ids } = await req.json()
    if (!first_reservation_id || !Array.isArray(pending_reservation_ids)) throw new Error('Champs manquants')
    if (!pending_reservation_ids.length) {
      return new Response(JSON.stringify({ succeeded: [], failed: [] }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const { data: profil } = await supabaseAdmin.from('profils').select('stripe_customer_id').eq('id', caller.id).maybeSingle()
    if (!profil?.stripe_customer_id) throw new Error('Aucun moyen de paiement enregistré')
    const customerId = profil.stripe_customer_id

    const { data: firstResa, error: firstErr } = await supabaseAdmin
      .from('reservations').select('id, user_id, stripe_payment_intent_id').eq('id', first_reservation_id).maybeSingle()
    if (firstErr) throw firstErr
    if (!firstResa || firstResa.user_id !== caller.id) throw new Error('Non autorisé')
    if (!firstResa.stripe_payment_intent_id) throw new Error('Premier paiement du panier introuvable')

    const firstPi = await stripe.paymentIntents.retrieve(firstResa.stripe_payment_intent_id)
    const paymentMethodId = typeof firstPi.payment_method === 'string' ? firstPi.payment_method : firstPi.payment_method?.id
    if (!paymentMethodId) throw new Error('Moyen de paiement introuvable — confirmez d\'abord la première prestation')

    const { data: pendingResas, error: pendingErr } = await supabaseAdmin
      .from('reservations')
      .select('id, user_id, lieu_id, montant_ht, stripe_payment_intent_id, statut_paiement')
      .in('id', pending_reservation_ids)
    if (pendingErr) throw pendingErr

    const lieuIds = [...new Set((pendingResas || []).map(r => r.lieu_id))]
    const { data: lieux } = await supabaseAdmin
      .from('lieux').select('id, stripe_account_id, commission_rate_percent').in('id', lieuIds)
    const lieuById = Object.fromEntries((lieux || []).map(l => [l.id, l]))

    let defaultPercent: number | null = null

    const succeeded: string[] = []
    const failed: { reservation_id: string; error: string }[] = []

    for (const resa of pendingResas || []) {
      try {
        if (resa.user_id !== caller.id) throw new Error('Non autorisé')
        if (resa.stripe_payment_intent_id || resa.statut_paiement !== 'en_attente') continue // deja traite

        const lieu = lieuById[resa.lieu_id]
        if (!lieu?.stripe_account_id) throw new Error('Prestataire sans paiements activés')

        let percent = lieu.commission_rate_percent
        if (percent === null || percent === undefined) {
          if (defaultPercent === null) {
            const { data: settings } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'commission_rate').maybeSingle()
            defaultPercent = settings?.value?.percent ?? 20
          }
          percent = defaultPercent
        }

        const amountCents = Math.round(Number(resa.montant_ht) * 100)
        const commissionCents = Math.round(amountCents * (percent / 100))

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'eur',
          customer: customerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          capture_method: 'manual',
          application_fee_amount: commissionCents,
          transfer_data: { destination: lieu.stripe_account_id },
          metadata: { reservation_id: resa.id, lieu_id: resa.lieu_id },
        })

        await supabaseAdmin.from('reservations').update({ stripe_payment_intent_id: paymentIntent.id }).eq('id', resa.id)
        succeeded.push(resa.id)
      } catch (itemErr) {
        await supabaseAdmin.from('reservations').update({ statut: 'annulee', statut_paiement: 'echoue' }).eq('id', resa.id)
        failed.push({ reservation_id: resa.id, error: itemErr.message })
      }
    }

    return new Response(JSON.stringify({ succeeded, failed }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
