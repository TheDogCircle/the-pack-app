-- Groupes crees par un compte pro (gerant d'une fiche lieu ou d'une marque) :
-- badge "Pro" et nom de la fiche affiches sur le groupe dans l'app. Les comptes
-- de l'equipe (admin_roles) sont exclus. Lisible par tous les membres connectes.
create or replace function groupes_pros()
returns table (groupe_id uuid, conversation_id uuid, pro_nom text)
language sql stable security definer set search_path = public as $$
  select distinct on (g.id) g.id, g.conversation_id, coalesce(l.nom, pt.nom)
  from groupes g
  left join lieux l on l.manager_user_id = g.created_by and l.actif
  left join partenaires pt on pt.manager_user_id = g.created_by
  where g.actif
    and (l.id is not null or pt.id is not null)
    and not exists (select 1 from admin_roles a where a.user_id = g.created_by)
  order by g.id, l.id nulls last;
$$;
revoke all on function groupes_pros() from public, anon;
grant execute on function groupes_pros() to authenticated;
