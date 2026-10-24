-- Correctif : classement_balades_mois faisait un CROSS JOIN sur le profil de
-- l'appelant ; sans profil (ou sans session), aucune ligne n'etait renvoyee, meme
-- pour la portee 'tous'. LEFT JOIN : 'tous' fonctionne toujours, les portees
-- meute / ville / race restent vides sans profil.

-- p_portee : 'meute' | 'ville' | 'race' | 'tous'
create or replace function classement_balades_mois(p_portee text default 'tous')
returns table (rang integer, user_id uuid, prenom text, nom_chien text, avatar_url text, km numeric, nb integer)
language sql
stable
security definer
set search_path = public
as $$
  with moi as (
    select id, lower(trim(ville)) as ville, lower(trim(race_chien)) as race from profils where id = auth.uid()
  ),
  totaux as (
    select b.user_id, sum(b.distance_km) as km, count(*)::integer as nb
    from balades b
    where b.created_at >= debut_mois_paris(0)
      and balade_eligible(b.distance_km, b.duree_secondes)
    group by b.user_id
  )
  select (rank() over (order by t.km desc))::integer, t.user_id, p.prenom, p.nom_chien, p.avatar_url,
         round(t.km::numeric, 1), t.nb
  from totaux t
  join profils p on p.id = t.user_id
  left join moi on true
  where case p_portee
    when 'meute' then t.user_id = moi.id or exists (
      select 1 from follows f where f.follower_id = moi.id and f.following_id = t.user_id and f.statut = 'accepte')
    when 'ville' then moi.ville is not null and lower(trim(p.ville)) = moi.ville
    when 'race' then moi.race is not null and lower(trim(p.race_chien)) = moi.race
    else true
  end
  order by t.km desc
  limit 100;
$$;
