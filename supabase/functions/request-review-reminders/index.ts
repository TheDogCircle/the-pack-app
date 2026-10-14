import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = { 'Content-Type': 'application/json' }

// Phase Pro 5 : demande d'avis apres la prestation -- meme pattern de flag
// booleen que les rappels (rappel_j3/j1/j0_envoye) pour ne jamais renvoyer
// deux fois. Cible les reservations 'terminee' depuis au moins 2h (laisse le
// temps au pro de corriger une erreur de "venu/absent" avant d'envoyer), en
// excluant les clients absents (rien a avis sur une prestation qui n'a pas
// eu lieu).
Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: allResas } = await supabase
    .from('reservations')
    .select('id, user_id, lieu_id, date, heure_fin, presence')
    .eq('statut', 'terminee')
    .eq('avis_demande_envoye', false)
    .limit(500)

  // Filtre en app (pas en requete) : compare date+heure_fin a "il y a 2h",
  // une combinaison de deux colonnes que PostgREST ne sait pas comparer
  // directement a une valeur calculee cote client.
  const seuil = Date.now() - 2 * 3_600_000
  const resas = (allResas || []).filter((r) => {
    if (r.presence === 'absent') return false
    return new Date(`${r.date}T${r.heure_fin}Z`).getTime() <= seuil
  })

  let sent = 0
  for (const resa of resas) {
    if (!resa.user_id) continue
    const { data: profil } = await supabase.from('profils').select('push_token').eq('id', resa.user_id).maybeSingle()
    const { data: lieu } = await supabase.from('lieux').select('nom').eq('id', resa.lieu_id).maybeSingle()
    if (profil?.push_token) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          to: profil.push_token,
          title: 'Comment était votre rendez-vous ?',
          body: `Laissez un avis pour ${lieu?.nom || 'votre prestataire'} — ça aide les autres membres de la Meute.`,
          data: { type: 'avis_demande', reservationId: resa.id, lieuId: resa.lieu_id },
          sound: 'default',
        }),
      })
    }
    await supabase.from('reservations').update({ avis_demande_envoye: true }).eq('id', resa.id)
    sent++
  }

  return new Response(JSON.stringify({ sent }), { headers: CORS })
})
