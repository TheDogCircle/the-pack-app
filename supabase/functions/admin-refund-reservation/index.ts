import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Remboursement (partiel ou total) decide par un admin depuis un ticket de
// litige -- distinct de cancel-reservation (self-service client/pro, calcule
// le pourcentage automatiquement selon la politique d'annulation). Ici le
// montant est choisi manuellement par l'admin, la reservation n'est pas
// necessairement annulee (ex: remboursement partiel pour un service rendu
// en partie), et c'est reserve a super_admin avec motif obligatoire.
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

    const { data: callerRole } = await supabaseAdmin.from('admin_roles').select('role').eq('user_id', caller.id).maybeSingle()
    if (callerRole?.role !== 'super_admin') throw new Error('Réservé aux super admins')

    const { ticket_id, reservation_id, amount_cents, motif } = await req.json()
    if (!reservation_id) throw new Error('reservation_id manquant')
    if (!motif || !motif.trim()) throw new Error('Motif obligatoire')

    const { data: resa, error: resaErr } = await supabaseAdmin
      .from('reservations')
      .select('id, montant_ht, montant_rembourse, stripe_payment_intent_id, statut_paiement')
      .eq('id', reservation_id)
      .maybeSingle()
    if (resaErr) throw resaErr
    if (!resa) throw new Error('Réservation introuvable')
    if (!resa.stripe_payment_intent_id) throw new Error('Aucun paiement Stripe associé à cette réservation')
    if (resa.statut_paiement !== 'paye' && resa.statut_paiement !== 'rembourse') {
      throw new Error("Cette réservation n'a pas de paiement confirmé à rembourser")
    }

    const totalCents = Math.round(Number(resa.montant_ht) * 100)
    const dejaRembourseCents = Math.round(Number(resa.montant_rembourse || 0) * 100)
    const restantCents = totalCents - dejaRembourseCents
    if (restantCents <= 0) throw new Error('Cette réservation est déjà intégralement remboursée')

    const demandeCents = amount_cents != null ? Math.round(Number(amount_cents)) : restantCents
    if (demandeCents <= 0 || demandeCents > restantCents) {
      throw new Error(`Montant invalide (restant remboursable : ${(restantCents / 100).toFixed(2)} €)`)
    }

    const refund = await stripe.refunds.create({
      payment_intent: resa.stripe_payment_intent_id,
      amount: demandeCents,
      refund_application_fee: true,
      reverse_transfer: true,
    })

    const nouveauMontantRembourse = (dejaRembourseCents + demandeCents) / 100
    const integralementRembourse = (dejaRembourseCents + demandeCents) >= totalCents
    await supabaseAdmin.from('reservations').update({
      montant_rembourse: nouveauMontantRembourse,
      ...(integralementRembourse ? { statut_paiement: 'rembourse', statut: 'annulee' } : {}),
    }).eq('id', reservation_id)

    if (ticket_id) {
      await supabaseAdmin.from('ticket_messages').insert({
        ticket_id,
        auteur_id: caller.id,
        visibilite: 'interne',
        contenu: `Remboursement de ${(demandeCents / 100).toFixed(2)} € effectué. Motif : ${motif.trim()}`,
      })
    }

    // Client scope (bearer de l'appelant, pas la service role) pour que
    // auth.uid() resolve correctement dans log_admin_action -- admin_audit_log
    // n'accepte des ecritures que via cette fonction SECURITY DEFINER, qui lit
    // auth.uid() en interne (cf Phase 1).
    const supabaseCaller = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    await supabaseCaller.rpc('log_admin_action', {
      p_action: 'refund', p_entity_type: 'reservations', p_entity_id: reservation_id,
      p_before: { montant_rembourse: resa.montant_rembourse || 0 },
      p_after: { montant_rembourse: nouveauMontantRembourse },
      p_reason: motif.trim(),
    })

    return new Response(JSON.stringify({
      refunded: true, refund_id: refund.id, montant_rembourse: nouveauMontantRembourse, integralement_rembourse: integralementRembourse,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
