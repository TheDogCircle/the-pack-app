-- Fix : "infinite recursion detected in policy for relation evenements_prives".
-- evenements_prives_select interrogeait evenements_invitations, dont la policy
-- evenements_invitations_select interrogeait evenements_prives en retour -- boucle.
-- Meme remede que my_conversation_ids() deja utilise ailleurs dans ce schema : des
-- fonctions SECURITY DEFINER, qui s'executent hors RLS, cassent le cycle.

create or replace function is_organisateur_evenement_prive(p_evenement_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from evenements_prives
    where id = p_evenement_id and organisateur_id = auth.uid()
  );
$$;

create or replace function is_invite_evenement_prive(p_evenement_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from evenements_invitations
    where evenement_id = p_evenement_id and invite_id = auth.uid()
  );
$$;

drop policy if exists "evenements_prives_select" on evenements_prives;
create policy "evenements_prives_select" on evenements_prives for select
  using (
    organisateur_id = auth.uid()
    or is_invite_evenement_prive(id)
  );

drop policy if exists "evenements_invitations_select" on evenements_invitations;
create policy "evenements_invitations_select" on evenements_invitations for select
  using (
    invite_id = auth.uid()
    or is_organisateur_evenement_prive(evenement_id)
  );

drop policy if exists "evenements_invitations_insert" on evenements_invitations;
create policy "evenements_invitations_insert" on evenements_invitations for insert
  with check (
    invited_by = auth.uid()
    and is_organisateur_evenement_prive(evenement_id)
  );
