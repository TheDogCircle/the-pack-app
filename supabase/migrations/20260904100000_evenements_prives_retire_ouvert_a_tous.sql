-- Retrait du concept "ouvert a tous" : un evenement prive est par definition sur
-- invitation, les deux ne font pas sens ensemble. Aucune ligne reelle n'utilisait
-- ouvert_a_tous=true au moment de ce retrait (verifie avant migration).

drop policy if exists "evenements_invitations_self_join_open" on evenements_invitations;

drop policy if exists "evenements_prives_select" on evenements_prives;
create policy "evenements_prives_select" on evenements_prives for select
  using (
    organisateur_id = auth.uid()
    or is_invite_evenement_prive(id)
  );

drop function if exists is_evenement_prive_ouvert(uuid);

-- La colonne ouvert_a_tous est laissee en place (inoffensive, plus jamais ecrite ni
-- lue par le client) plutot que supprimee, pour rester reversible sans risque.
