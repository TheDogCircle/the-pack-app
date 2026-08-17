import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Une reservation "en_attente" plus vieille que ce delai est consideree
// abandonnee (paiement jamais termine) et ne bloque plus le creneau.
const ABANDON_MINUTES = 15

function addMinutes(hhmmss: string, minutes: number): string {
  const [h, m, s] = hhmmss.split(':').map(Number)
  const total = h * 60 + m + minutes
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(s || 0).padStart(2, '0')}`
}

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

    const { lieu_id, prestation_id, date, heure_debut, client_prenom, client_tel } = await req.json()
    if (!lieu_id || !prestation_id || !date || !heure_debut || !client_prenom) {
      throw new Error('Champs manquants')
    }

    const [{ data: lieu, error: lieuErr }, { data: prestation, error: prestaErr }] = await Promise.all([
      supabaseAdmin.from('lieux').select('id, nom, plan, stripe_account_id, stripe_charges_enabled').eq('id', lieu_id).maybeSingle(),
      supabaseAdmin.from('prestations').select('id, lieu_id, prix, duree, actif').eq('id', prestation_id).maybeSingle(),
    ])
    if (lieuErr) throw lieuErr
    if (prestaErr) throw prestaErr
    if (!lieu) throw new Error('Lieu introuvable')
    if (!['pro', 'premium'].includes(lieu.plan)) throw new Error("Ce lieu n'a pas accès aux réservations en ligne")
    if (!lieu.stripe_account_id || !lieu.stripe_charges_enabled) {
      throw new Error("Ce prestataire n'a pas encore activé les paiements en ligne")
    }
    if (!prestation || prestation.lieu_id !== lieu_id || !prestation.actif) throw new Error('Prestation introuvable')
    if (!prestation.prix || prestation.prix <= 0) throw new Error('Prestation sans tarif défini')

    const heure_fin = addMinutes(heure_debut, prestation.duree)

    // Verifie la disponibilite cote serveur (le calcul de carte.html est purement client).
    // disponibilites.jour suit la convention 0=lundi...6=dimanche (cf. espace-pro.html),
    // pas le getDay() natif de JS/Date qui est 0=dimanche : on convertit.
    const jour = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
    const { data: dispo, error: dispoErr } = await supabaseAdmin
      .from('disponibilites')
      .select('heure_debut, heure_fin')
      .eq('lieu_id', lieu_id)
      .eq('jour', jour)
      .maybeSingle()
    if (dispoErr) throw dispoErr
    if (!dispo || heure_debut < dispo.heure_debut || heure_fin > dispo.heure_fin) {
      throw new Error("Ce créneau n'est pas disponible")
    }

    // Libere les reservations "en_attente" abandonnees sur ce creneau precis
    await supabaseAdmin
      .from('reservations')
      .update({ statut: 'annulee', statut_paiement: 'echoue' })
      .eq('lieu_id', lieu_id)
      .eq('date', date)
      .eq('heure_debut', heure_debut)
      .eq('statut', 'en_attente')
      .lt('created_at', new Date(Date.now() - ABANDON_MINUTES * 60_000).toISOString())

    const { data: settings } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'commission_rate').maybeSingle()
    const percent = settings?.value?.percent ?? 20

    const { data: reservation, error: insertErr } = await supabaseAdmin
      .from('reservations')
      .insert({
        lieu_id, prestation_id,
        user_id: caller.id,
        client_prenom, client_tel: client_tel || null,
        client_email: caller.email || null,
        date, heure_debut, heure_fin,
        statut: 'en_attente',
        statut_paiement: 'en_attente',
        montant_ht: prestation.prix,
      })
      .select('id')
      .single()

    if (insertErr) {
      if (insertErr.code === '23505') throw new Error('Ce créneau vient d\'être réservé par quelqu\'un d\'autre')
      throw insertErr
    }

    const amountCents = Math.round(Number(prestation.prix) * 100)
    const commissionCents = Math.round(amountCents * (percent / 100))

    let paymentIntent
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'eur',
        payment_method_types: ['card'],
        application_fee_amount: commissionCents,
        transfer_data: { destination: lieu.stripe_account_id },
        metadata: { reservation_id: reservation.id, lieu_id, prestation_id },
      })
    } catch (stripeErr) {
      await supabaseAdmin.from('reservations').delete().eq('id', reservation.id)
      throw stripeErr
    }

    await supabaseAdmin
      .from('reservations')
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq('id', reservation.id)

    return new Response(JSON.stringify({ client_secret: paymentIntent.client_secret, reservation_id: reservation.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
