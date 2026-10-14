// Phase Pro 5 : resolution du taux de commission reellement applique a un
// paiement. organizations.commission_rate est la source d'autorite depuis
// le socle commun (super_admin only, cf docs/socle.md) -- avant cette phase,
// create-payment-intent/create-cart-reservations/purchase-forfait lisaient
// encore directement lieux.commission_rate_percent, qui pouvait diverger du
// taux affiche a l'admin et au pro (tous deux deja rebranches sur
// organizations depuis la Phase Pro 2). lieux.commission_rate_percent et
// app_settings restent des repli pour un lieu pas encore rattache a une
// organisation approuvee (org_places).
export async function resolveCommissionPercent(supabaseAdmin: any, lieuId: string): Promise<number> {
  const { data: place } = await supabaseAdmin
    .from('org_places').select('org_id').eq('lieu_id', lieuId).eq('statut', 'approved').maybeSingle()
  if (place?.org_id) {
    const { data: org } = await supabaseAdmin.from('organizations').select('commission_rate').eq('id', place.org_id).maybeSingle()
    if (org?.commission_rate != null) return Number(org.commission_rate)
  }
  const { data: lieu } = await supabaseAdmin.from('lieux').select('commission_rate_percent').eq('id', lieuId).maybeSingle()
  if (lieu?.commission_rate_percent != null) return Number(lieu.commission_rate_percent)
  const { data: settings } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'commission_rate').maybeSingle()
  return settings?.value?.percent ?? 20
}
