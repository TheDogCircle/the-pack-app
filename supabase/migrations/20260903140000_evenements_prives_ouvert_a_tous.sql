-- Option "ouvert a tous" pour un evenement prive : au lieu d'inviter des personnes
-- une a une, l'organisateur peut laisser l'event visible et rejoignable par tout
-- utilisateur connecte de l'app (mais toujours absent du flux Evenements public).

alter table evenements_prives add column if not exists ouvert_a_tous boolean not null default false;

create or replace function is_evenement_prive_ouvert(p_evenement_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select ouvert_a_tous from evenements_prives where id = p_evenement_id), false);
$$;

-- Un evenement ouvert est visible par tout le monde, pas seulement organisateur/invites.
drop policy if exists "evenements_prives_select" on evenements_prives;
create policy "evenements_prives_select" on evenements_prives for select
  using (
    organisateur_id = auth.uid()
    or ouvert_a_tous = true
    or is_invite_evenement_prive(id)
  );

-- Auto-invitation (rejoindre directement) : uniquement possible si l'evenement est
-- ouvert_a_tous -- policy additive (PERMISSIVE, combinee en OR avec l'existante), donc
-- l'invitation par l'organisateur reste inchangee pour les evenements sur invitation.
create policy "evenements_invitations_self_join_open" on evenements_invitations for insert
  with check (
    invite_id = auth.uid()
    and invited_by = auth.uid()
    and is_evenement_prive_ouvert(evenement_id)
  );

-- Le trigger ne gerait que les UPDATE (accepter une invitation recue). Rejoindre un
-- evenement ouvert insere directement une ligne statut='accepte' -- il faut donc que
-- le meme trigger fasse aussi rejoindre le salon sur INSERT, pas seulement sur transition.
create or replace function join_conversation_on_invitation_accepted()
returns trigger language plpgsql security definer as $$
begin
  if new.statut = 'accepte' and (TG_OP = 'INSERT' or OLD.statut <> 'accepte') then
    insert into conversation_members (conversation_id, user_id)
    select conversation_id, new.invite_id
    from evenements_prives where id = new.evenement_id and conversation_id is not null
    on conflict do nothing;
    new.responded_at = now();
  elsif TG_OP = 'UPDATE' and new.statut = 'refuse' and OLD.statut <> 'refuse' then
    new.responded_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_evenement_invitation_response on evenements_invitations;
create trigger on_evenement_invitation_response
  before insert or update on evenements_invitations
  for each row execute function join_conversation_on_invitation_accepted();
