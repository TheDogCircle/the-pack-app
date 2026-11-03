-- Nombre de membres des groupes publics (onglet Groupes de l'app).
-- L'app comptait les lignes de conversation_members, mais la RLS ne laisse voir
-- que les membres des conversations dont on fait partie : un groupe pas encore
-- rejoint affichait "0 membre". Cette fonction ne renvoie qu'un NOMBRE par
-- groupe public actif (aucune identite de membre), groupes prives exclus.

create or replace function groupes_nombre_membres()
returns table (conversation_id uuid, nb_membres bigint)
language sql
stable
security definer
set search_path = public
as $$
  select g.conversation_id, count(m.user_id)
  from groupes g
  left join conversation_members m on m.conversation_id = g.conversation_id
  where g.actif and g.conversation_id is not null
  group by g.conversation_id;
$$;

revoke all on function groupes_nombre_membres() from public;
grant execute on function groupes_nombre_membres() to anon, authenticated;
