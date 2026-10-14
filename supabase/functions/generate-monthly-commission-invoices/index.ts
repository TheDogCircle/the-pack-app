import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateAndStoreInvoice } from '../_shared/commissionInvoicePdf.ts'

// Phase Pro 7, point 5 : cron le 5 de chaque mois (pg_cron, cf migration
// SQL) -- pour chaque organisation marque : genere la facture de
// commission du mois precedent si des ventes brand_sale validees existent,
// sinon relance si aucune declaration n'a meme ete soumise. Jamais les
// deux en meme temps pour une organisation donnee (soit il y a une
// facture a generer, soit il manque une declaration -- pas les deux).
Deno.serve(async (_req) => {
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const now = new Date()
  const moisPrecedent = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const periode = moisPrecedent.toISOString().slice(0, 7) // YYYY-MM
  const periodeLabel = moisPrecedent.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  const { data: orgs } = await supabaseAdmin.from('organizations').select('id, nom').eq('segment', 'marque')

  let factures = 0, relances = 0
  for (const org of orgs || []) {
    try {
      const result = await generateAndStoreInvoice(supabaseAdmin, org.id, periode)
      if (result) {
        factures++
        continue
      }
    } catch (e) {
      console.error('generateAndStoreInvoice', org.id, e.message)
      continue
    }

    // Aucune vente validee -- verifie si une declaration a seulement ete
    // soumise sans encore etre traitee (on ne relance pas dans ce cas,
    // elle est deja dans la file de l'admin) ou si elle manque carrement.
    const { data: decl } = await supabaseAdmin
      .from('declarations_ventes_marque').select('id').eq('org_id', org.id).eq('periode_mois', moisPrecedent.toISOString().slice(0, 10)).maybeSingle()
    if (!decl) {
      // Meme pattern que stripe-webhook (fetch direct + cle service role en
      // Authorization) plutot que supabaseAdmin.functions.invoke, pour
      // rester coherent avec la seule convention deja etablie dans ce repo
      // pour un edge function qui en appelle un autre.
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-declaration-manquante`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ org_id: org.id, periode_label: periodeLabel }),
      }).catch((e) => console.error('notify-declaration-manquante', e.message))
      relances++
    }
  }

  return new Response(JSON.stringify({ periode, factures, relances }), { headers: { 'Content-Type': 'application/json' } })
})
