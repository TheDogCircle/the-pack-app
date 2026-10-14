// Phase Pro 5 : chaque paiement/remboursement de reservation ecrit une
// ligne revenue_events -- table posee par le socle commun mais jamais
// alimentee pour les reservations jusqu'ici (seul le webhook d'abonnement
// Stripe l'utilisait, cf docs/socle.md). org_id resolu via org_places (lieu
// approuve) -- si aucune organisation n'existe encore pour ce lieu, on
// n'ecrit rien plutot que d'inventer un org_id (revenue_events.org_id est
// not null, pas de ligne orpheline).
async function resolveOrgId(supabaseAdmin: any, lieuId: string): Promise<string | null> {
  const { data: place } = await supabaseAdmin
    .from('org_places').select('org_id').eq('lieu_id', lieuId).eq('statut', 'approved').maybeSingle()
  return place?.org_id ?? null
}

export async function recordBookingRevenue(supabaseAdmin: any, params: {
  lieuId: string
  grossCents: number
  commissionCents: number
  externalRef: string
  occurredAt?: string
}) {
  const orgId = await resolveOrgId(supabaseAdmin, params.lieuId)
  if (!orgId) return
  await supabaseAdmin.from('revenue_events').insert({
    org_id: orgId,
    type: 'booking',
    source: 'stripe_webhook',
    gross_amount_cents: params.grossCents,
    commission_amount_cents: params.commissionCents,
    net_amount_cents: params.grossCents - params.commissionCents,
    external_ref: params.externalRef,
    occurred_at: params.occurredAt ?? new Date().toISOString(),
  })
}

// amount_cents ici est le montant REELLEMENT rembourse (pas le total de la
// reservation) -- commissionCents la part de commission rendue avec lui
// (cf refund_application_fee, deja utilise par cancel-reservation/
// admin-refund-reservation). Pas de ligne si le montant rembourse est nul
// (annulation client <24h, deja geree sans appel Stripe).
export async function recordRefundRevenue(supabaseAdmin: any, params: {
  lieuId: string
  refundedGrossCents: number
  refundedCommissionCents: number
  externalRef: string
  createdBy?: string | null
}) {
  if (params.refundedGrossCents <= 0) return
  const orgId = await resolveOrgId(supabaseAdmin, params.lieuId)
  if (!orgId) return
  await supabaseAdmin.from('revenue_events').insert({
    org_id: orgId,
    type: 'refund',
    source: 'stripe_webhook',
    gross_amount_cents: -params.refundedGrossCents,
    commission_amount_cents: -params.refundedCommissionCents,
    net_amount_cents: -(params.refundedGrossCents - params.refundedCommissionCents),
    external_ref: params.externalRef,
    created_by: params.createdBy ?? null,
  })
}
