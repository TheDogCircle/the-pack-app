-- Groupes publics : la fiche `groupes` et sa conversation sont desactivees /
-- reactivees ensemble. Avant, "Supprimer" dans l'app desactivait la
-- conversation puis tentait de desactiver le groupe cote client : si la 2e
-- ecriture echouait, le groupe restait visible (on pouvait y ecrire) mais la
-- conversation disparaissait de la liste des discussions de tous ses membres
-- (cas du groupe "Balade", constate le 03/11).

create or replace function sync_actif_conversation_vers_groupe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  update groupes set actif = new.actif where conversation_id = new.id and actif is distinct from new.actif;
  return new;
end;
$$;

create or replace function sync_actif_groupe_vers_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.conversation_id is null then return new; end if;
  update conversations set actif = new.actif where id = new.conversation_id and actif is distinct from new.actif;
  return new;
end;
$$;

drop trigger if exists zz_conversations_sync_groupe on conversations;
create trigger zz_conversations_sync_groupe after update of actif on conversations
  for each row when (old.actif is distinct from new.actif)
  execute function sync_actif_conversation_vers_groupe();

drop trigger if exists zz_groupes_sync_conversation on groupes;
create trigger zz_groupes_sync_conversation after update of actif on groupes
  for each row when (old.actif is distinct from new.actif)
  execute function sync_actif_groupe_vers_conversation();

-- Rattrapage : conversations desactivees dont le groupe est encore actif
update conversations c set actif = true
from groupes g
where g.conversation_id = c.id and g.actif and not c.actif;
