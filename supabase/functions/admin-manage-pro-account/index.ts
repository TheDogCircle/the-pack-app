import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Deux actions sensibles sur un compte pro (lieux/partenaires), reservees a
// super_admin -- plus strict que le reste de la fiche (SIRET/KBIS, moderator+)
// car on touche l'identifiant de connexion reel (auth.users), pas juste une
// donnee de fiche.
//
// - attach_owner : rattache un compte existant (trouve par email) a une fiche
//   qui n'a pas encore de manager_user_id. Ne cree jamais de faux compte --
//   si personne n'existe avec cet email, le pro doit d'abord s'inscrire.
//   Une fois manager_user_id pose, le trigger trg_lieux_sync_org/
//   trg_partenaires_sync_org (cf 20261013400000) cree l'organisation
//   automatiquement -- rien a faire ici pour ca.
// - update_email : change l'email de connexion d'un compte deja rattache
//   (ex: le pro a donne une mauvaise adresse, ou change d'email pro).
//   email_confirm:true -- l'admin atteste que l'adresse est correcte, pas de
//   re-confirmation par mail (a revoir si Marine prefere que le pro confirme
//   lui-meme).
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

    const { data: callerRole } = await supabaseAdmin.from('admin_roles').select('role').eq('user_id', caller.id).maybeSingle()
    if (callerRole?.role !== 'super_admin') throw new Error('Réservé aux super admins')

    // Client scope sur le JWT de l'appelant (pas le service role) -- utilise
    // pour toute ecriture qu'un super_admin peut deja faire via sa propre
    // session (RLS), pour que le declenchement en cascade (triggers d'audit,
    // creation automatique d'organisation) voie le vrai acteur plutot que
    // auth.uid() = null. Sans ca, create_organization_for_pro() cree bien
    // l'organisation (le trigger tourne quel que soit l'appelant), mais rien
    // n'est trace dans admin_audit_log -- trouve en testant avant de livrer.
    const supabaseCaller = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const body = await req.json()
    const { mode, sourceTable, entityId } = body
    if (!['lieux', 'partenaires'].includes(sourceTable)) throw new Error('sourceTable invalide')
    if (!entityId) throw new Error('entityId manquant')

    let logAction: string, logBefore: Record<string, unknown> | null, logAfter: Record<string, unknown> | null, logReason: string | null = null

    if (mode === 'attach_owner') {
      const { email } = body
      if (!email || !email.trim()) throw new Error('email manquant')

      const { data: row } = await supabaseAdmin.from(sourceTable).select('id, manager_user_id, nom').eq('id', entityId).maybeSingle()
      if (!row) throw new Error('Fiche introuvable')
      if (row.manager_user_id) throw new Error('Cette fiche a déjà un compte rattaché — utilisez "Modifier l\'email" pour en changer')

      // auth.admin.listUsers est pagine (max 1000/page, pas de getUserByEmail
      // dans ce projet) -- boucle jusqu'a trouver ou epuiser les pages, pour
      // ne pas rater un compte au-dela de la premiere page (gap trouve dans
      // lookup-user en construisant cette fonction).
      let found: { id: string; email?: string } | null = null
      for (let page = 1; page <= 50 && !found; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw error
        found = data.users.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase()) ?? null
        if (data.users.length < 1000) break
      }
      if (!found) throw new Error(`Aucun compte avec l'email ${email.trim()} — le pro doit d'abord créer un compte`)

      // Via supabaseCaller (pas supabaseAdmin) : un super_admin peut deja
      // ecrire manager_user_id via sa propre RLS, et ca permet au trigger de
      // synchronisation (create_organization_for_pro) de creer l'organisation
      // sous le vrai auth.uid() de l'admin, donc d'etre audite normalement.
      const { error: updateErr } = await supabaseCaller.from(sourceTable).update({ manager_user_id: found.id }).eq('id', entityId)
      if (updateErr) throw updateErr
      await supabaseAdmin.from('profils').upsert({ id: found.id, is_pro: true }, { onConflict: 'id' })

      logAction = 'attach_owner'
      logBefore = { manager_user_id: null }
      logAfter = { manager_user_id: found.id, email: found.email }
    } else if (mode === 'update_email') {
      const { ownerId, newEmail } = body
      if (!ownerId) throw new Error('ownerId manquant')
      if (!newEmail || !newEmail.trim()) throw new Error('newEmail manquant')

      const { data: row } = await supabaseAdmin.from(sourceTable).select('manager_user_id').eq('id', entityId).maybeSingle()
      if (!row || row.manager_user_id !== ownerId) throw new Error('Ce compte ne correspond pas à cette fiche')

      const { data: before } = await supabaseAdmin.auth.admin.getUserById(ownerId)
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(ownerId, { email: newEmail.trim(), email_confirm: true })
      if (updateErr) throw updateErr

      logAction = 'update_email'
      logBefore = { email: before?.user?.email ?? null }
      logAfter = { email: newEmail.trim() }
    } else {
      throw new Error('mode invalide')
    }

    // entity_type/entity_id = la fiche (sourceTable/entityId), pas
    // l'utilisateur, pour que ça apparaisse dans l'Historique de la fiche
    // admin (renderAuditHistory filtre dessus).
    await supabaseCaller.rpc('log_admin_action', {
      p_action: logAction, p_entity_type: sourceTable, p_entity_id: entityId,
      p_before: logBefore, p_after: logAfter, p_reason: logReason,
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
