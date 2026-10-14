import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

// Phase Pro 7, point 8 : cron quotidien -- pour chaque campagne terminee
// (date_fin passee) sans bilan, mesure vues/clics de la periode et genere
// un PDF (meme bucket marque-documents que les factures de commission).
// "vues" = analytics_events de la marque (target_type='partenaire') sur la
// fenetre date_debut-date_fin -- pas isole par campagne individuelle si
// plusieurs campagnes de la meme marque se chevauchent (aucun tracking par
// campagne_id sur analytics_events aujourd'hui, documente comme limite
// connue, meme esprit que "pas de verification bloquante" ailleurs dans
// cette phase). "clics codes" = events code_clic des codes_partenaires
// explicitement relies a cette campagne (campagne_id), eux correctement
// isoles. Ignore les campagnes sans org_id (restes legacy anterieurs au
// backfill, jamais rattaches a une organisation -- pas de dossier Storage
// possible pour elles).
async function buildBilanPdf(params: {
  titre: string
  partenaireNom: string
  periodeLabel: string
  vues: number
  clics: number
  clicsCodes: number
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595.28, 841.89])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const bordeaux = rgb(0.24, 0.1, 0.1)
  const gris = rgb(0.4, 0.4, 0.4)

  let y = 790
  page.drawText('The Pack — Bilan de campagne', { x: 50, y, size: 18, font: fontBold, color: bordeaux })
  y -= 26
  page.drawText(`${params.titre} — ${params.partenaireNom}`, { x: 50, y, size: 12, font, color: gris })
  y -= 18
  page.drawText(params.periodeLabel, { x: 50, y, size: 11, font, color: gris })
  y -= 40

  const lignes = [
    ['Vues de la vitrine', String(params.vues)],
    ['Clics vers le site', String(params.clics)],
    ['Clics sur un code/lien de cette campagne', String(params.clicsCodes)],
  ]
  for (const [label, valeur] of lignes) {
    page.drawText(label, { x: 50, y, size: 11, font })
    page.drawText(valeur, { x: 470, y, size: 11, font: fontBold, color: bordeaux })
    y -= 22
  }

  return doc.save()
}

Deno.serve(async (_req) => {
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: campagnes } = await supabaseAdmin
    .from('campagnes')
    .select('id, titre, partenaire_id, org_id, date_debut, date_fin, bilan_notes')
    .lt('date_fin', new Date().toISOString().slice(0, 10))
    .is('bilan_envoye_at', null)
    .not('org_id', 'is', null)

  let generes = 0
  for (const c of campagnes || []) {
    try {
      const { data: partenaire } = await supabaseAdmin.from('partenaires').select('nom').eq('id', c.partenaire_id).maybeSingle()
      const finFenetre = new Date(c.date_fin)
      finFenetre.setDate(finFenetre.getDate() + 1)

      const { count: vues } = await supabaseAdmin
        .from('analytics_events').select('*', { count: 'exact', head: true })
        .eq('event_type', 'page_view').eq('target_type', 'partenaire').eq('target_id', c.partenaire_id)
        .gte('created_at', c.date_debut).lt('created_at', finFenetre.toISOString())
      const { count: clics } = await supabaseAdmin
        .from('analytics_events').select('*', { count: 'exact', head: true })
        .eq('event_type', 'click').eq('target_type', 'partenaire').eq('target_id', c.partenaire_id)
        .gte('created_at', c.date_debut).lt('created_at', finFenetre.toISOString())

      const { data: codes } = await supabaseAdmin.from('codes_partenaires').select('code').eq('campagne_id', c.id)
      let clicsCodes = 0
      if (codes && codes.length) {
        const { count } = await supabaseAdmin
          .from('events').select('*', { count: 'exact', head: true })
          .eq('event_name', 'code_clic').in('properties->>code', codes.map((x: any) => x.code))
          .gte('created_at', c.date_debut).lt('created_at', finFenetre.toISOString())
        clicsCodes = count || 0
      }

      const periodeLabel = `${new Date(c.date_debut).toLocaleDateString('fr-FR')} — ${new Date(c.date_fin).toLocaleDateString('fr-FR')}`
      const pdfBytes = await buildBilanPdf({
        titre: c.titre,
        partenaireNom: partenaire?.nom || 'Marque',
        periodeLabel,
        vues: vues || 0,
        clics: clics || 0,
        clicsCodes,
      })

      const path = `${c.org_id}/bilan-campagne-${c.id}.pdf`
      const { error: uploadErr } = await supabaseAdmin.storage.from('marque-documents').upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true })
      if (uploadErr) throw uploadErr

      await supabaseAdmin.from('campagnes').update({
        statut: 'bilan_envoye',
        bilan_envoye_at: new Date().toISOString(),
        bilan_pdf_url: path,
        bilan_notes: c.bilan_notes || `Bilan automatique : ${vues || 0} vues, ${clics || 0} clics, ${clicsCodes} clic(s) sur un code de campagne.`,
      }).eq('id', c.id)

      generes++
    } catch (e) {
      console.error('generate-campaign-bilans', c.id, e.message)
    }
  }

  return new Response(JSON.stringify({ generes }), { headers: { 'Content-Type': 'application/json' } })
})
