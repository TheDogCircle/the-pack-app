import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

// Phase Pro 7 : construit et stocke la facture de commission mensuelle
// d'une marque -- partagee entre generate-commission-invoice (appel admin
// a la demande) et generate-monthly-commission-invoices (cron, toutes les
// organisations marque) pour ne jamais dupliquer la logique PDF.
async function buildInvoicePdf(params: {
  orgNom: string
  periodeLabel: string
  lignes: { libelle: string; grossCents: number; commissionCents: number }[]
  totalGrossCents: number
  totalCommissionCents: number
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  let page = doc.addPage([595.28, 841.89]) // A4
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const bordeaux = rgb(0.24, 0.1, 0.1)
  const gris = rgb(0.4, 0.4, 0.4)

  let y = 790
  page.drawText('The Pack — Facture de commission', { x: 50, y, size: 18, font: fontBold, color: bordeaux })
  y -= 26
  page.drawText(`${params.orgNom} — ${params.periodeLabel}`, { x: 50, y, size: 12, font, color: gris })
  y -= 40

  page.drawText('Détail', { x: 50, y, size: 11, font: fontBold, color: bordeaux })
  y -= 18
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: gris })
  y -= 16
  for (const ligne of params.lignes) {
    page.drawText(ligne.libelle, { x: 50, y, size: 10, font, color: rgb(0, 0, 0) })
    page.drawText(`${(ligne.grossCents / 100).toFixed(2)} €`, { x: 380, y, size: 10, font })
    page.drawText(`${(ligne.commissionCents / 100).toFixed(2)} €`, { x: 470, y, size: 10, font })
    y -= 16
    if (y < 80) { page = doc.addPage([595.28, 841.89]); y = 790 }
  }
  y -= 10
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: gris })
  y -= 20
  page.drawText('Total ventes attribuées', { x: 50, y, size: 11, font: fontBold })
  page.drawText(`${(params.totalGrossCents / 100).toFixed(2)} €`, { x: 380, y, size: 11, font: fontBold })
  y -= 20
  page.drawText('Commission The Pack due', { x: 50, y, size: 12, font: fontBold, color: bordeaux })
  page.drawText(`${(params.totalCommissionCents / 100).toFixed(2)} €`, { x: 470, y, size: 12, font: fontBold, color: bordeaux })

  return doc.save()
}

// Retourne null si aucune vente brand_sale n'existe pour cette periode
// (rien a facturer, pas une erreur).
export async function generateAndStoreInvoice(supabaseAdmin: any, orgId: string, periode: string): Promise<{ pdf_url: string; montant_commission_cents: number } | null> {
  const periodeDate = new Date(periode + (periode.length === 7 ? '-01' : ''))
  const periodeStart = new Date(periodeDate.getFullYear(), periodeDate.getMonth(), 1)
  const periodeEnd = new Date(periodeDate.getFullYear(), periodeDate.getMonth() + 1, 1)

  const { data: org } = await supabaseAdmin.from('organizations').select('nom').eq('id', orgId).maybeSingle()
  const { data: events } = await supabaseAdmin
    .from('revenue_events').select('gross_amount_cents, commission_amount_cents, external_ref, occurred_at')
    .eq('org_id', orgId).eq('type', 'brand_sale')
    .gte('occurred_at', periodeStart.toISOString()).lt('occurred_at', periodeEnd.toISOString())

  if (!events || !events.length) return null

  const totalGrossCents = events.reduce((s: number, e: any) => s + e.gross_amount_cents, 0)
  const totalCommissionCents = events.reduce((s: number, e: any) => s + e.commission_amount_cents, 0)
  const periodeLabel = periodeStart.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  const pdfBytes = await buildInvoicePdf({
    orgNom: org?.nom || 'Marque',
    periodeLabel,
    lignes: events.map((e: any, i: number) => ({
      libelle: `Vente attribuée #${i + 1} (${new Date(e.occurred_at).toLocaleDateString('fr-FR')})`,
      grossCents: e.gross_amount_cents, commissionCents: e.commission_amount_cents,
    })),
    totalGrossCents, totalCommissionCents,
  })

  const path = `${orgId}/facture-${periodeStart.toISOString().slice(0, 7)}.pdf`
  const { error: uploadErr } = await supabaseAdmin.storage.from('marque-documents').upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true })
  if (uploadErr) throw uploadErr

  await supabaseAdmin.from('factures_commission_marque').upsert({
    org_id: orgId, periode: periodeStart.toISOString().slice(0, 10),
    montant_commission_cents: totalCommissionCents, pdf_url: path,
  }, { onConflict: 'org_id,periode' })

  return { pdf_url: path, montant_commission_cents: totalCommissionCents }
}
