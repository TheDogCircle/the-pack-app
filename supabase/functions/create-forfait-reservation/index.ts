import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// Reserve une seance en utilisant un credit de forfait deja achete -- aucun
// paiement ici (deja regle a l'achat du forfait), le credit n'est decompte
// qu'a la confirmation par le prestataire (cf confirm-reservation), pas a la
// demande : si le prestataire refuse, rien n'est consomme.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
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

    const { forfait_achete_id, prestation_id, date, heure_debut, client_prenom, client_tel, chien_id } = await req.json()
    if (!forfait_achete_id || !prestation_id || !date || !heure_debut || !client_prenom) {
      throw new Error('Champs manquants')
    }

    const { data: achat, error: achatErr } = await supabaseAdmin
      .from('forfaits_achetes')
      .select('id, lieu_id, user_id, nb_seances_total, nb_seances_utilisees, date_expiration, forfaits(prestation_id)')
      .eq('id', forfait_achete_id).maybeSingle()
    if (achatErr) throw achatErr
    if (!achat || achat.user_id !== caller.id) throw new Error('Forfait introuvable')
    if (achat.nb_seances_utilisees >= achat.nb_seances_total) throw new Error('Toutes les séances de ce forfait ont déjà été utilisées')
    if (achat.date_expiration && achat.date_expiration < new Date().toISOString().slice(0, 10)) throw new Error('Ce forfait a expiré')

    const forfaitPrestationId = (achat as any).forfaits?.prestation_id
    if (forfaitPrestationId && forfaitPrestationId !== prestation_id) {
      throw new Error("Ce forfait n'est valable que pour une prestation spécifique")
    }

    const { data: prestation, error: prestaErr } = await supabaseAdmin
      .from('prestations').select('id, lieu_id, duree, actif').eq('id', prestation_id).maybeSingle()
    if (prestaErr) throw prestaErr
    if (!prestation || prestation.lieu_id !== achat.lieu_id || !prestation.actif) throw new Error('Prestation introuvable')

    const heure_fin = addMinutes(heure_debut, prestation.duree)
    const jour = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
    const { data: dispo, error: dispoErr } = await supabaseAdmin
      .from('disponibilites').select('heure_debut, heure_fin').eq('lieu_id', achat.lieu_id).eq('jour', jour).maybeSingle()
    if (dispoErr) throw dispoErr
    if (!dispo || heure_debut < dispo.heure_debut || heure_fin > dispo.heure_fin) {
      throw new Error("Ce créneau n'est pas disponible")
    }

    await supabaseAdmin
      .from('reservations')
      .update({ statut: 'annulee', statut_paiement: 'echoue' })
      .eq('lieu_id', achat.lieu_id).eq('date', date).eq('heure_debut', heure_debut).eq('statut', 'en_attente')
      .lt('created_at', new Date(Date.now() - ABANDON_MINUTES * 60_000).toISOString())

    const { data: reservation, error: insertErr } = await supabaseAdmin
      .from('reservations')
      .insert({
        lieu_id: achat.lieu_id, prestation_id, forfait_achete_id, chien_id: chien_id || null,
        user_id: caller.id, client_prenom, client_tel: client_tel || null, client_email: caller.email || null,
        date, heure_debut, heure_fin, statut: 'en_attente', statut_paiement: 'forfait', montant_ht: 0,
      })
      .select('id').single()
    if (insertErr) {
      if (insertErr.code === '23505') throw new Error('Ce créneau vient d\'être réservé par quelqu\'un d\'autre')
      throw insertErr
    }

    return new Response(JSON.stringify({ reservation_id: reservation.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
