import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { chargeSolde } from '../_shared/offerPricing.ts'
import { recordBookingRevenue } from '../_shared/revenueEvents.ts'

Deno.serve(async (req) => {
  // Cle API utilisee uniquement pour les appels reservation/Connect (test mode).
  // Les abonnements pro (checkout.session.completed / customer.subscription.*)
  // sont en LIVE mode sur ce meme compte Stripe : on ne fait jamais d'appel API
  // avec cette cle pour ces evenements-la (voir plus bas), seule la verification
  // de signature differe (secret test vs secret live, essayes l'un puis l'autre).
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' })
  const webhookSecrets = [Deno.env.get('STRIPE_WEBHOOK_SECRET'), Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')].filter(Boolean) as string[]

  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event | null = null
  let lastErr: Error | null = null
  if (signature) {
    for (const secret of webhookSecrets) {
      try {
        event = await stripe.webhooks.constructEventAsync(body, signature, secret)
        break
      } catch (err) {
        lastErr = err
      }
    }
  }
  if (!event) {
    console.error('Signature Stripe invalide:', lastErr?.message ?? 'signature manquante')
    return new Response('Signature invalide', { status: 400 })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Miroir sur organizations (socle commun, cf docs/socle.md) : un lieu peut
  // etre gere par au plus une organisation approuvee (org_places.statut) --
  // si aucune n'existe encore (compte pas migre / pas encore rattache),
  // simplement aucune ligne a mettre a jour, pas une erreur.
  async function resolveOrgIdForLieu(lieuId: string): Promise<string | null> {
    const { data } = await supabaseAdmin
      .from('org_places').select('org_id').eq('lieu_id', lieuId).eq('statut', 'approved').maybeSingle()
    return data?.org_id ?? null
  }

  // Resout le plan (essentiel/premium) a partir du prix Stripe de
  // l'abonnement -- trouve en recette (2026-10-13) : avant ce correctif,
  // AUCUN code ne mettait jamais organizations.plan/lieux.plan a jour pour
  // un vrai abonnement paye via les Payment Links statiques (checkout.session.
  // completed ne pose que le statut/les IDs, jamais le plan ; seul
  // activate-lieu-plan le fait, et uniquement pour l'essai gratuit instantane
  // de l'ecran de choix obligatoire). Un etablissement non-educateur qui
  // payait reellement Essentiel/Premium via "S'abonner ->" ne recevait donc
  // jamais ses droits. Se base sur sub.items.data[0].price, deja inclus dans
  // le payload de l'evenement (meme contrainte test/live que le reste de ce
  // fichier : pas d'appel API Stripe). Ne resout que le mensuel (offres
  // n'a qu'une ligne 'month' par plan) -- un abonnement annuel ne matche
  // aucun prix connu et le plan n'est alors pas touche (pas de valeur
  // inventee), meme logique que le reste de ce fichier pour un rattachement
  // non resolu.
  async function resolvePlanFromPrice(price: Stripe.Price | null | undefined): Promise<string | null> {
    if (!price?.unit_amount || price.recurring?.interval !== 'month') return null
    const { data: offres } = await supabaseAdmin
      .from('offres').select('plan_key, prix_cents').eq('intervalle', 'month').not('prix_cents', 'is', null)
    return (offres || []).find((o) => o.prix_cents === price.unit_amount)?.plan_key ?? null
  }

  // Notifie l'owner (email) via notify-subscription-event -- meme pattern de
  // fetch interne que notify-reservation plus haut dans ce fichier. Jamais
  // bloquant : un echec d'envoi d'email ne doit pas faire echouer le webhook
  // (Stripe retente sinon indefiniment un evenement deja traite cote donnees).
  async function notifySubscriptionEvent(orgId: string, eventName: string): Promise<void> {
    const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-subscription-event`
    await fetch(notifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ org_id: orgId, event: eventName }),
    }).catch((e) => console.error('notify-subscription-event call failed:', e.message))
  }

  function addMinutesAbo(hhmmss: string, minutes: number): string {
    const [h, m, s] = hhmmss.split(':').map(Number)
    const total = h * 60 + m + minutes
    const hh = Math.floor(total / 60) % 24
    const mm = total % 60
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(s || 0).padStart(2, '0')}`
  }

  // Materialise la PROCHAINE reservation d'un abonnement recurrent (Phase
  // Pro 5) a chaque facture payee -- jamais tout le calendrier d'un coup.
  // Idempotent via stripe_payment_intent_id (Stripe peut renvoyer le meme
  // evenement plusieurs fois). La Subscription est en test mode (meme cle
  // que le reste des paiements Connect de ce fichier, contrairement aux
  // abonnements SaaS pro traites plus bas) -- un appel API ici est donc sans
  // risque de decalage test/live.
  async function materializeAbonnementReservation(invoice: Stripe.Invoice): Promise<void> {
    const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
    if (!subId) return
    const { data: abonnement } = await supabaseAdmin
      .from('abonnements_reservations').select('*').eq('stripe_subscription_id', subId).maybeSingle()
    if (!abonnement || abonnement.statut !== 'actif') return

    const paymentIntentId = typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id
    if (paymentIntentId) {
      const { data: existing } = await supabaseAdmin
        .from('reservations').select('id').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle()
      if (existing) return
    }

    const { data: offer } = await supabaseAdmin.from('offers').select('legacy_prestation_id').eq('id', abonnement.offer_id).maybeSingle()
    if (!offer?.legacy_prestation_id) {
      console.error('materializeAbonnementReservation: offre sans miroir legacy_prestation_id', abonnement.offer_id)
      return
    }
    const { data: offerPrice } = await supabaseAdmin.from('offer_prices').select('duree_minutes').eq('id', abonnement.offer_price_id).maybeSingle()
    const dureeMinutes = offerPrice?.duree_minutes || 60

    // Prochaine occurrence du jour configure (0=lundi...6=dimanche, meme
    // convention que disponibilites.jour), a partir du debut de periode
    // facturee.
    const date = new Date(invoice.period_start * 1000)
    const currentJour = (date.getUTCDay() + 6) % 7
    const diff = (abonnement.jour_semaine - currentJour + 7) % 7
    date.setUTCDate(date.getUTCDate() + diff)
    const dateStr = date.toISOString().slice(0, 10)
    const heureFin = addMinutesAbo(abonnement.heure_debut, dureeMinutes)

    let commissionCents = 0
    if (paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
        commissionCents = pi.application_fee_amount ?? 0
      } catch (e) { console.error('retrieve PI abonnement:', e.message) }
    }

    const { data: profil } = await supabaseAdmin.from('profils').select('prenom').eq('id', abonnement.user_id).maybeSingle()

    const { error } = await supabaseAdmin.from('reservations').insert({
      lieu_id: abonnement.lieu_id, prestation_id: offer.legacy_prestation_id,
      offer_id: abonnement.offer_id, offer_price_id: abonnement.offer_price_id,
      user_id: abonnement.user_id, chien_id: abonnement.chien_id, client_prenom: profil?.prenom || null,
      date: dateStr, heure_debut: abonnement.heure_debut, heure_fin: heureFin,
      statut: 'confirmee', statut_paiement: 'paye',
      montant_ht: invoice.amount_paid / 100, montant_commission: commissionCents / 100,
      stripe_payment_intent_id: paymentIntentId || null,
    })
    if (error) {
      console.error('materializeAbonnementReservation insert:', error.message)
      return
    }

    await recordBookingRevenue(supabaseAdmin, {
      lieuId: abonnement.lieu_id, grossCents: invoice.amount_paid, commissionCents, externalRef: invoice.id,
    })
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent

        // Achat de forfait (plusieurs seances) : rien a voir avec une ligne
        // reservations existante, on cree directement le credit de seances.
        if (pi.metadata?.kind === 'forfait_achat') {
          const validiteJours = pi.metadata.validite_jours ? Number(pi.metadata.validite_jours) : null
          const dateExpiration = validiteJours
            ? new Date(Date.now() + validiteJours * 86_400_000).toISOString().slice(0, 10)
            : null
          await supabaseAdmin.from('forfaits_achetes').insert({
            forfait_id: pi.metadata.forfait_id,
            offer_id: pi.metadata.offer_id || null,
            offer_price_id: pi.metadata.offer_price_id || null,
            lieu_id: pi.metadata.lieu_id,
            user_id: pi.metadata.user_id,
            nb_seances_total: Number(pi.metadata.nb_seances),
            prix_paye: Number(pi.metadata.prix),
            stripe_payment_intent_id: pi.id,
            date_expiration: dateExpiration,
          })
          // revenue_events (Phase Pro 5) : achat d'un forfait paye en
          // totalite ici (pas de notion d'acompte sur un forfait).
          await recordBookingRevenue(supabaseAdmin, {
            lieuId: pi.metadata.lieu_id,
            grossCents: Math.round(Number(pi.metadata.prix) * 100),
            commissionCents: pi.application_fee_amount ?? 0,
            externalRef: pi.id,
          })
          break
        }

        const commission = (pi.application_fee_amount ?? 0) / 100

        // Acompte (Phase Pro 4) : ce succeeded peut n'etre que le depot, pas
        // le paiement complet -- determine si la reservation doit rester
        // en_attente (confirmation manuelle du prestataire requise) ou si
        // elle se confirme tout de suite (offre + organisation autorisent la
        // confirmation automatique), auquel cas le solde est charge ici.
        const { data: resaCheck } = await supabaseAdmin
          .from('reservations').select('id, offer_id, solde_statut').eq('stripe_payment_intent_id', pi.id).maybeSingle()

        let depositOnly = false
        if (resaCheck?.solde_statut === 'a_charger' && resaCheck.offer_id) {
          const { data: offer } = await supabaseAdmin.from('offers').select('confirmation_manuelle, lieu_id').eq('id', resaCheck.offer_id).maybeSingle()
          if (offer) {
            const { data: place } = await supabaseAdmin.from('org_places').select('org_id').eq('lieu_id', offer.lieu_id).eq('statut', 'approved').maybeSingle()
            const { data: rules } = place?.org_id
              ? await supabaseAdmin.from('org_booking_rules').select('confirmation_auto').eq('org_id', place.org_id).maybeSingle()
              : { data: null }
            depositOnly = !(!offer.confirmation_manuelle && rules?.confirmation_auto)
          }
        }

        const { data: resa, error } = await supabaseAdmin
          .from('reservations')
          .update(depositOnly
            ? { statut_paiement: 'acompte_paye' }
            : { statut: 'confirmee', statut_paiement: 'paye', montant_commission: commission })
          .eq('stripe_payment_intent_id', pi.id)
          .select('*, lieux(stripe_account_id, commission_rate_percent)')
          .maybeSingle()
        if (error) throw error

        let totalCommissionCents = pi.application_fee_amount ?? 0
        if (resa && !depositOnly && resa.solde_statut === 'a_charger') {
          // Confirmation automatique avec acompte : le solde est du tout de
          // suite, pas d'attente d'une confirmation manuelle separee. Cumule
          // sa commission avec celle (deja ecrite ci-dessus) de l'acompte.
          try {
            const soldePi = await chargeSolde(stripe, supabaseAdmin, resa)
            if (soldePi?.application_fee_amount) {
              totalCommissionCents += soldePi.application_fee_amount
              await supabaseAdmin.from('reservations')
                .update({ montant_commission: commission + soldePi.application_fee_amount / 100 })
                .eq('id', resa.id)
            }
          } catch (e) {
            console.error('chargeSolde (auto):', e.message)
          }
        }

        // revenue_events (Phase Pro 5) : reservation entierement payee a cet
        // instant sans intervention du prestataire (confirmation automatique,
        // avec ou sans acompte) -- l'equivalent du chemin confirm-reservation
        // pour une confirmation manuelle, qui ecrit deja sa propre ligne.
        if (resa && !depositOnly) {
          await recordBookingRevenue(supabaseAdmin, {
            lieuId: resa.lieu_id,
            grossCents: Math.round(Number(resa.montant_ht) * 100),
            commissionCents: totalCommissionCents,
            externalRef: pi.id,
          })
        }

        if (resa && !depositOnly) {
          const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-reservation`
          await fetch(notifyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ record: resa }),
          }).catch((e) => console.error('notify-reservation call failed:', e.message))
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        await supabaseAdmin
          .from('reservations')
          .update({ statut: 'annulee', statut_paiement: 'echoue' })
          .eq('stripe_payment_intent_id', pi.id)
        break
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account
        const status = account.details_submitted
          ? (account.charges_enabled ? 'active' : 'restricted')
          : 'pending'
        await supabaseAdmin
          .from('lieux')
          .update({
            stripe_onboarding_status: status,
            stripe_charges_enabled: !!account.charges_enabled,
            stripe_payouts_enabled: !!account.payouts_enabled,
          })
          .eq('stripe_account_id', account.id)
        break
      }

      // Abonnement SaaS pro (starter/essentiel/pro/premium) — distinct du Connect
      // ci-dessus, qui concerne les paiements reservation/commission encaisses par
      // l'educateur. client_reference_id est pose cote client (espace-pro.html,
      // tagStripeSubscriptionLinks) car les Payment Links sont statiques et ne
      // portent aucun contexte par defaut.
      //
      // Volontairement aucun appel a l'API Stripe (stripe.subscriptions.retrieve
      // etc.) dans ce webhook pour ces evenements : la cle configuree ici est en
      // mode test, alors que ces abonnements sont en live sur le meme compte. On
      // ne se sert que des donnees deja incluses dans le payload de l'evenement.
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription' || !session.client_reference_id) break
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
        const patch = {
          stripe_subscription_customer_id: customerId ?? null,
          stripe_subscription_id: subscriptionId ?? null,
          // Statut optimiste : checkout.session.completed n'est envoye qu'apres
          // succes du paiement initial. L'evenement customer.subscription.created
          // (quasi simultane) corrige/confirme juste apres avec le statut exact.
          subscription_status: 'active',
        }
        await supabaseAdmin.from('lieux').update(patch).eq('id', session.client_reference_id)

        // Miroir sur organizations (socle commun). stripe_customer_id existe
        // deja sur organizations (identifiant Stripe generique de
        // l'organisation, meme colonne alimentee par la migration de donnees
        // du socle depuis lieux.stripe_subscription_customer_id) -- pas de
        // nouvelle colonne, juste la meme valeur mise a jour ici aussi.
        const orgId = await resolveOrgIdForLieu(session.client_reference_id)
        if (orgId) {
          await supabaseAdmin.from('organizations').update({
            stripe_customer_id: patch.stripe_subscription_customer_id,
            stripe_subscription_id: patch.stripe_subscription_id,
            subscription_status: patch.subscription_status,
          }).eq('id', orgId)
        }
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        // unit_amount/interval viennent directement de l'objet Subscription
        // standard inclus dans l'evenement (sub.items.data[0].price) -- pas
        // d'appel API necessaire, donc pas de probleme avec le decalage
        // cle test/live mentionne plus haut dans ce fichier.
        const price = sub.items?.data?.[0]?.price
        const resolvedPlan = await resolvePlanFromPrice(price)
        const subPatch = {
          subscription_status: sub.status,
          subscription_current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          subscription_amount_cents: price?.unit_amount ?? null,
          subscription_interval: price?.recurring?.interval ?? null,
          // Pose uniquement a la creation (jamais ecrase par un update
          // ulterieur) -- sert de point de depart pour le NPS "30j apres
          // l'abonnement" (Phase 6 lot 5).
          ...(event.type === 'customer.subscription.created' ? { subscription_started_at: new Date().toISOString() } : {}),
          // Pose le vrai plan paye (voir resolvePlanFromPrice ci-dessus).
          // Applique a chaque update, pas seulement a la creation : couvre
          // aussi le changement de forfait via le portail client Stripe, et
          // restaure le plan si un paiement est regularise apres qu'un
          // retour a Decouverte ait deja eu lieu (delai de grace expire).
          ...(resolvedPlan ? { plan: resolvedPlan } : {}),
        }

        // Statut avant mise a jour, pour ne notifier que sur une veritable
        // transition (Stripe peut renvoyer plusieurs fois le meme evenement).
        const { data: existingLieu } = await supabaseAdmin
          .from('lieux').select('id, subscription_status').eq('stripe_subscription_id', sub.id).maybeSingle()
        const previousStatus = existingLieu?.subscription_status ?? null

        const { data: lieu } = await supabaseAdmin
          .from('lieux').update(subPatch).eq('stripe_subscription_id', sub.id).select('id').maybeSingle()

        // Miroir sur organizations (socle commun).
        let orgId: string | null = null
        if (lieu) {
          orgId = await resolveOrgIdForLieu(lieu.id)
          if (orgId) await supabaseAdmin.from('organizations').update(subPatch).eq('id', orgId)
        }

        // Delai de grace (7 jours, cf. trg_organizations_grace_deadline posee
        // sur organizations.subscription_status) : ce webhook se contente de
        // notifier l'owner sur la transition, le passage effectif a
        // 'decouverte' apres 7 jours est fait par le cron
        // run_subscription_grace_check(), pas ici.
        const wasOverdue = previousStatus === 'past_due' || previousStatus === 'unpaid'
        const isOverdue = sub.status === 'past_due' || sub.status === 'unpaid'
        if (orgId && isOverdue && !wasOverdue) {
          await notifySubscriptionEvent(orgId, 'payment_failed')
        } else if (orgId && sub.status === 'active' && wasOverdue) {
          await notifySubscriptionEvent(orgId, 'payment_recovered')
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        // Resiliation volontaire (effective fin de periode, deja le
        // comportement Stripe) : contrairement a l'impaye, aucun delai de
        // grace -- retour immediat a Decouverte sur les trois tables
        // miroirs, donnees conservees.
        const cancelPatch = {
          subscription_status: 'canceled',
          subscription_canceled_at: new Date().toISOString(),
          plan: 'decouverte',
        }
        const { data: lieu } = await supabaseAdmin
          .from('lieux').update(cancelPatch).eq('stripe_subscription_id', sub.id).select('id').maybeSingle()

        if (lieu) {
          const orgId = await resolveOrgIdForLieu(lieu.id)
          if (orgId) {
            await supabaseAdmin.from('organizations').update(cancelPatch).eq('id', orgId)
            await supabaseAdmin.from('partenaires').update({ plan: 'decouverte' }).eq('org_id', orgId)
            await notifySubscriptionEvent(orgId, 'canceled')
          }
        }
        break
      }

      // Factures d'abonnement pro -- memes contraintes que les evenements
      // customer.subscription.* ci-dessus : aucun appel API Stripe, on ne lit
      // que le payload de l'Invoice deja fourni par l'evenement. Rattachement
      // au compte (lieux ou partenaires, cf schema Phase 5) via
      // stripe_subscription_customer_id ; si aucun match, la facture est tout
      // de meme stockee (customer_table/customer_id a null) plutot que perdue.
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.voided': {
        const invoice = event.data.object as Stripe.Invoice

        // Reservation recurrente (Phase Pro 5) -- distincte des factures
        // d'abonnement SaaS pro traitees plus bas dans ce meme cas. Reperee
        // via la metadata posee sur la Subscription a sa creation
        // (create-abonnement-reservation), recopiee par Stripe sur chaque
        // facture (invoice.subscription_details.metadata) sans appel API.
        if (invoice.subscription_details?.metadata?.kind === 'abonnement_reservation') {
          if (event.type === 'invoice.paid') await materializeAbonnementReservation(invoice)
          break
        }

        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
        if (!customerId) break

        let customerTable: 'lieux' | 'partenaires' | null = null
        let customerRowId: string | null = null
        const { data: lieu } = await supabaseAdmin
          .from('lieux').select('id').eq('stripe_subscription_customer_id', customerId).maybeSingle()
        if (lieu) {
          customerTable = 'lieux'
          customerRowId = lieu.id
        } else {
          const { data: partenaire } = await supabaseAdmin
            .from('partenaires').select('id').eq('stripe_subscription_customer_id', customerId).maybeSingle()
          if (partenaire) {
            customerTable = 'partenaires'
            customerRowId = partenaire.id
          }
        }

        // Resout org_id (socle commun) via le meme match que customerTable/
        // customerRowId ci-dessus. Omis du upsert si non resolu, pour ne
        // jamais ecraser un rattachement deja fait a la main
        // (reconcile_stripe_invoice) -- seul un org_id resolu ici est ecrit.
        let orgId: string | null = null
        if (customerTable === 'lieux' && customerRowId) {
          orgId = await resolveOrgIdForLieu(customerRowId)
        } else if (customerTable === 'partenaires' && customerRowId) {
          const { data: partenaire } = await supabaseAdmin
            .from('partenaires').select('org_id').eq('id', customerRowId).maybeSingle()
          orgId = partenaire?.org_id ?? null
        }

        const status = event.type === 'invoice.voided' ? 'void' : (invoice.status ?? (event.type === 'invoice.paid' ? 'paid' : 'open'))
        await supabaseAdmin.from('stripe_invoices').upsert({
          stripe_invoice_id: invoice.id,
          stripe_customer_id: customerId,
          customer_table: customerTable,
          customer_id: customerRowId,
          ...(orgId ? { org_id: orgId } : {}),
          amount_cents: event.type === 'invoice.paid' ? invoice.amount_paid : invoice.amount_due,
          currency: invoice.currency ?? 'eur',
          status,
          hosted_invoice_url: invoice.hosted_invoice_url ?? null,
          invoice_pdf_url: invoice.invoice_pdf ?? null,
          invoice_created_at: new Date(invoice.created * 1000).toISOString(),
          paid_at: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : null,
        }, { onConflict: 'stripe_invoice_id' })

        // Ligne revenue_events (socle commun) -- idempotent par external_ref,
        // meme garde que reconcile_stripe_invoice (une facture Stripe donnee
        // ne doit jamais etre comptee deux fois, y compris si Stripe renvoie
        // l'evenement en double).
        if (event.type === 'invoice.paid' && orgId) {
          const { data: existingEvent } = await supabaseAdmin
            .from('revenue_events').select('id').eq('external_ref', invoice.id).maybeSingle()
          if (!existingEvent) {
            await supabaseAdmin.from('revenue_events').insert({
              org_id: orgId,
              type: 'subscription',
              gross_amount_cents: invoice.amount_paid,
              commission_amount_cents: 0,
              net_amount_cents: invoice.amount_paid,
              source: 'stripe_webhook',
              external_ref: invoice.id,
              occurred_at: invoice.status_transitions?.paid_at
                ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
                : new Date().toISOString(),
            })
          }
        }
        break
      }
    }
  } catch (err) {
    console.error('Erreur traitement webhook Stripe:', err.message)
    return new Response('Erreur interne', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
