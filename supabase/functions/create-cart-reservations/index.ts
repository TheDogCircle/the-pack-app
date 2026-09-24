import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ABANDON_MINUTES = 15

function addMinutes(hhmmss: string, minutes: number): string {
  const [h, m, s] = hhmmss.split(':').map(Number)
  const total = h * 60 + m + minutes
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(s || 0).padStart(2, '0')}`
}

// Premiere etape du panier (plusieurs prestations/dates en une seule
// demande) : cree toutes les lignes reservations d'un coup, mais ne peut
// autoriser le paiement que de la PREMIERE -- les suivantes n'ont pas
// encore de moyen de paiement a utiliser. On enregistre la carte du client
// (Stripe Customer + setup_future_usage) au passage sur ce premier paiement
// pour pouvoir la reutiliser hors-session sur le reste du panier
// (cf. finalize-cart-payments, appelee par le client une fois ce premier
// paiement confirme).
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

    const { lieu_id, items, client_prenom, client_tel } = await req.json()
    if (!lieu_id || !Array.isArray(items) || !items.length || !client_prenom) {
      throw new Error('Champs manquants')
    }

    const { data: lieu, error: lieuErr } = await supabaseAdmin
      .from('lieux').select('id, plan, stripe_account_id, stripe_charges_enabled, commission_rate_percent')
      .eq('id', lieu_id).maybeSingle()
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

    // Client Stripe : reutilise celui deja enregistre sur le profil, sinon
    // en cree un (necessaire pour reutiliser la carte hors-session ensuite).
    const { data: profil } = await supabaseAdmin.from('profils').select('stripe_customer_id').eq('id', caller.id).maybeSingle()
    let customerId = profil?.stripe_customer_id || null
    if (!customerId) {
      const customer = await stripe.customers.create({ email: caller.email || undefined, metadata: { user_id: caller.id } })
      customerId = customer.id
      await supabaseAdmin.from('profils').update({ stripe_customer_id: customerId }).eq('id', caller.id)
    }

    const panierId = crypto.randomUUID()
    const inserted: { reservation_id: string; prestation_id: string; prix: number; percent: number }[] = []
    const failed: { prestation_id: string; date: string; heure_debut: string; error: string }[] = []

    for (const item of items) {
      try {
        const { prestation_id, date, heure_debut } = item
        if (!prestation_id || !date || !heure_debut) throw new Error('Champs manquants')

        const { data: prestation, error: prestaErr } = await supabaseAdmin
          .from('prestations').select('id, lieu_id, prix, duree, actif').eq('id', prestation_id).maybeSingle()
        if (prestaErr) throw prestaErr
        if (!prestation || prestation.lieu_id !== lieu_id || !prestation.actif) throw new Error('Prestation introuvable')
        if (!prestation.prix || prestation.prix <= 0) throw new Error('Prestation sans tarif défini')

        const heure_fin = addMinutes(heure_debut, prestation.duree)
        const jour = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
        const { data: dispo, error: dispoErr } = await supabaseAdmin
          .from('disponibilites').select('heure_debut, heure_fin').eq('lieu_id', lieu_id).eq('jour', jour).maybeSingle()
        if (dispoErr) throw dispoErr
        if (!dispo || heure_debut < dispo.heure_debut || heure_fin > dispo.heure_fin) {
          throw new Error("Ce créneau n'est pas disponible")
        }

        await supabaseAdmin
          .from('reservations')
          .update({ statut: 'annulee', statut_paiement: 'echoue' })
          .eq('lieu_id', lieu_id).eq('date', date).eq('heure_debut', heure_debut).eq('statut', 'en_attente')
          .lt('created_at', new Date(Date.now() - ABANDON_MINUTES * 60_000).toISOString())

        const { data: reservation, error: insertErr } = await supabaseAdmin
          .from('reservations')
          .insert({
            lieu_id, prestation_id, panier_id: panierId,
            user_id: caller.id, client_prenom, client_tel: client_tel || null, client_email: caller.email || null,
            date, heure_debut, heure_fin, statut: 'en_attente', statut_paiement: 'en_attente', montant_ht: prestation.prix,
          })
          .select('id').single()
        if (insertErr) {
          if (insertErr.code === '23505') throw new Error('Ce créneau vient d\'être réservé par quelqu\'un d\'autre')
          throw insertErr
        }

        inserted.push({ reservation_id: reservation.id, prestation_id, prix: Number(prestation.prix), percent })
      } catch (itemErr) {
        failed.push({ prestation_id: item.prestation_id, date: item.date, heure_debut: item.heure_debut, error: itemErr.message })
      }
    }

    if (!inserted.length) {
      return new Response(JSON.stringify({ error: 'Aucune prestation du panier n\'a pu être réservée', failed }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const first = inserted[0]
    const amountCents = Math.round(first.prix * 100)
    const commissionCents = Math.round(amountCents * (first.percent / 100))

    let paymentIntent
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'eur',
        payment_method_types: ['card'],
        capture_method: 'manual',
        customer: customerId,
        setup_future_usage: 'off_session',
        application_fee_amount: commissionCents,
        transfer_data: { destination: lieu.stripe_account_id },
        metadata: { reservation_id: first.reservation_id, lieu_id, prestation_id: first.prestation_id, panier_id: panierId },
      })
    } catch (stripeErr) {
      await supabaseAdmin.from('reservations').delete().in('id', inserted.map(i => i.reservation_id))
      throw stripeErr
    }

    await supabaseAdmin.from('reservations').update({ stripe_payment_intent_id: paymentIntent.id }).eq('id', first.reservation_id)

    return new Response(JSON.stringify({
      panier_id: panierId,
      first: { reservation_id: first.reservation_id, client_secret: paymentIntent.client_secret },
      pending_reservation_ids: inserted.slice(1).map(i => i.reservation_id),
      failed,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
