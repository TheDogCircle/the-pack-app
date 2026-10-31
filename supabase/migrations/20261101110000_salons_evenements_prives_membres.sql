-- Salons des evenements prives : l'organisateur et les invites ayant accepte
-- doivent etre membres du salon (et seulement eux).
--
-- Existant : le trigger on_evenement_invitation_response ajoutait deja l'invite
-- au salon quand il accepte. On le complete :
--  - un invite qui repasse d'"accepte" a "refuse" quitte le salon ;
--  - l'organisateur est toujours membre (trigger sur evenements_prives, au lieu de
--    dependre uniquement de l'insert fait par l'app / le site) ;
--  - securite : on n'ajoute quelqu'un que si le salon est bien un salon
--    d'evenement cree par l'organisateur (avant, un organisateur pouvait pointer
--    conversation_id vers n'importe quelle conversation dont il connaissait l'id
--    et s'y faire ajouter via une invitation acceptee) ;
--  - rattrapage des organisateurs / participants existants.

-- Salon legitime d'un evenement prive
create or replace function public.salon_evenement_prive_valide(p_evenement uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.conversation_id
  from public.evenements_prives e
  join public.conversations c on c.id = e.conversation_id
  where e.id = p_evenement
    and c.type = 'evenement_prive'
    and c.created_by = e.organisateur_id;
$$;
revoke all on function public.salon_evenement_prive_valide(uuid) from public, anon, authenticated;

create or replace function public.join_conversation_on_invitation_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon uuid := public.salon_evenement_prive_valide(new.evenement_id);
begin
  if new.statut = 'accepte' and (TG_OP = 'INSERT' or OLD.statut is distinct from 'accepte') then
    if v_salon is not null then
      insert into public.conversation_members (conversation_id, user_id)
      values (v_salon, new.invite_id)
      on conflict (conversation_id, user_id) do nothing;
    end if;
    new.responded_at = now();
  elsif TG_OP = 'UPDATE' and OLD.statut = 'accepte' and new.statut is distinct from 'accepte' then
    -- Ne participe plus : quitte le salon (jamais l'organisateur)
    if v_salon is not null then
      delete from public.conversation_members cm
      using public.evenements_prives e
      where e.id = new.evenement_id
        and cm.conversation_id = v_salon
        and cm.user_id = new.invite_id
        and cm.user_id <> e.organisateur_id;
    end if;
    if new.statut = 'refuse' then new.responded_at = now(); end if;
  elsif TG_OP = 'UPDATE' and new.statut = 'refuse' and OLD.statut is distinct from 'refuse' then
    new.responded_at = now();
  end if;
  return new;
end;
$$;
-- Le trigger on_evenement_invitation_response existant appelle deja cette fonction.

create or replace function public.evenement_prive_organisateur_membre()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon uuid := public.salon_evenement_prive_valide(new.id);
begin
  if v_salon is not null then
    insert into public.conversation_members (conversation_id, user_id)
    values (v_salon, new.organisateur_id)
    on conflict (conversation_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_evenement_prive_organisateur_membre on public.evenements_prives;
create trigger trg_evenement_prive_organisateur_membre
  after insert or update of conversation_id, organisateur_id on public.evenements_prives
  for each row execute function public.evenement_prive_organisateur_membre();

-- Rattrapage : organisateurs + invites ayant accepte, evenements actifs
insert into public.conversation_members (conversation_id, user_id)
select v.salon, v.user_id
from (
  select public.salon_evenement_prive_valide(e.id) as salon, e.organisateur_id as user_id
  from public.evenements_prives e
  where e.actif
  union
  select public.salon_evenement_prive_valide(e.id), i.invite_id
  from public.evenements_invitations i
  join public.evenements_prives e on e.id = i.evenement_id
  where e.actif and i.statut = 'accepte'
) v
where v.salon is not null and v.user_id is not null
on conflict (conversation_id, user_id) do nothing;
