-- Classement MENSUEL (1er du mois 0 h -> fin du mois, heure de Paris), avec
-- quatre portees comme Tractive : meute (moi + suivis), ville, race, tous.
-- Badges calcules a la volee depuis les balades eligibles (pas de table) :
-- la date d'obtention est celle de la balade qui a fait passer le palier.
-- Reutilise balade_eligible() et debut_semaine_paris() (20261025090000).

create or replace function debut_mois_paris(p_decalage_mois integer default 0)
returns timestamptz
language sql
stable
as $$
  select (date_trunc('month', now() at time zone 'Europe/Paris') - make_interval(months => p_decalage_mois))
         at time zone 'Europe/Paris';
$$;

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
  cross join moi
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
grant execute on function classement_balades_mois(text) to authenticated;

-- Stats perso : on garde les champs "semaine" (compatibilite) et on ajoute le mois
create or replace function mes_stats_balades()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi uuid := auth.uid();
  v_km numeric; v_nb integer; v_mkm numeric; v_mnb integer; v_rang_mois integer;
  v_serie integer := 0;
  i integer;
begin
  if v_moi is null then return null; end if;

  select coalesce(sum(distance_km), 0), count(*) into v_km, v_nb
  from balades where user_id = v_moi and created_at >= debut_semaine_paris(0)
    and balade_eligible(distance_km, duree_secondes);

  select coalesce(sum(distance_km), 0), count(*) into v_mkm, v_mnb
  from balades where user_id = v_moi and created_at >= debut_mois_paris(0)
    and balade_eligible(distance_km, duree_secondes);

  select c.rang into v_rang_mois from classement_balades_mois('tous') c where c.user_id = v_moi;

  for i in (case when v_nb > 0 then 0 else 1 end)..52 loop
    exit when not exists (
      select 1 from balades
      where user_id = v_moi
        and created_at >= debut_semaine_paris(i) and created_at < debut_semaine_paris(i - 1)
        and balade_eligible(distance_km, duree_secondes)
    );
    v_serie := v_serie + 1;
  end loop;

  return jsonb_build_object(
    'semaine_km', round(v_km, 1), 'semaine_nb', v_nb,
    'mois_km', round(v_mkm, 1), 'mois_nb', v_mnb, 'rang_mois', v_rang_mois,
    'rang', v_rang_mois,
    'serie_semaines', v_serie,
    'total_km', (select round(coalesce(sum(distance_km), 0)::numeric, 1) from balades
                 where user_id = v_moi and balade_eligible(distance_km, duree_secondes)),
    'total_nb', (select count(*) from balades
                 where user_id = v_moi and balade_eligible(distance_km, duree_secondes))
  );
end;
$$;

-- Badges : [{code, categorie, titre, palier, obtenu, date, progression}]
create or replace function mes_badges_balades(p_user uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
  v_total_km numeric; v_total_nb integer; v_max_km numeric; v_max_serie integer;
  v_out jsonb := '[]'::jsonb;
  r record;
begin
  if v_user is null then return '[]'::jsonb; end if;

  create temp table if not exists _b (created_at timestamptz, distance_km double precision, cum_km double precision, n integer) on commit drop;
  delete from _b;
  insert into _b
  select created_at, distance_km,
         sum(distance_km) over (order by created_at),
         (row_number() over (order by created_at))::integer
  from balades
  where user_id = v_user and balade_eligible(distance_km, duree_secondes);

  select coalesce(max(cum_km), 0), coalesce(max(n), 0), coalesce(max(distance_km), 0)
  into v_total_km, v_total_nb, v_max_km from _b;

  -- Distance cumulee
  for r in select * from (values (10,'km_10','10 km'),(50,'km_50','50 km'),(100,'km_100','100 km'),
                                 (250,'km_250','250 km'),(500,'km_500','500 km'),(1000,'km_1000','1 000 km')) v(seuil, code, titre) loop
    v_out := v_out || jsonb_build_object('code', r.code, 'categorie', 'distance', 'titre', r.titre, 'palier', r.seuil,
      'obtenu', v_total_km >= r.seuil,
      'date', (select min(created_at) from _b where cum_km >= r.seuil),
      'progression', least(1, round((v_total_km / r.seuil)::numeric, 3)));
  end loop;

  -- Nombre de balades
  for r in select * from (values (1,'nb_1','Première balade'),(10,'nb_10','10 balades'),(50,'nb_50','50 balades'),(100,'nb_100','100 balades')) v(seuil, code, titre) loop
    v_out := v_out || jsonb_build_object('code', r.code, 'categorie', 'balades', 'titre', r.titre, 'palier', r.seuil,
      'obtenu', v_total_nb >= r.seuil,
      'date', (select created_at from _b where n = r.seuil),
      'progression', least(1, round((v_total_nb::numeric / r.seuil), 3)));
  end loop;

  -- Exploits : une seule longue balade
  for r in select * from (values (5,'longue_5','Balade de 5 km'),(10,'longue_10','Balade de 10 km')) v(seuil, code, titre) loop
    v_out := v_out || jsonb_build_object('code', r.code, 'categorie', 'exploit', 'titre', r.titre, 'palier', r.seuil,
      'obtenu', v_max_km >= r.seuil,
      'date', (select min(created_at) from _b where distance_km >= r.seuil),
      'progression', least(1, round((v_max_km / r.seuil)::numeric, 3)));
  end loop;

  -- Regularite : semaines consecutives avec au moins une balade (ilots de semaines)
  with semaines as (
    select distinct date_trunc('week', created_at at time zone 'Europe/Paris') as s from _b
  ), ilots as (
    select s, s - make_interval(weeks => (row_number() over (order by s))::integer) as grp from semaines
  ), series as (
    select grp, count(*)::integer as longueur, min(s) as debut from ilots group by grp
  )
  select coalesce(max(longueur), 0) into v_max_serie from series;
  for r in select * from (values (4,'serie_4','4 semaines d''affilée'),(12,'serie_12','12 semaines d''affilée')) v(seuil, code, titre) loop
    v_out := v_out || jsonb_build_object('code', r.code, 'categorie', 'regularite', 'titre', r.titre, 'palier', r.seuil,
      'obtenu', v_max_serie >= r.seuil,
      'date', (
        with semaines as (select distinct date_trunc('week', created_at at time zone 'Europe/Paris') as s from _b),
        ilots as (select s, s - make_interval(weeks => (row_number() over (order by s))::integer) as grp from semaines),
        series as (select grp, count(*) as longueur, min(s) as debut from ilots group by grp)
        select min(debut + make_interval(weeks => r.seuil - 1)) at time zone 'Europe/Paris' from series where longueur >= r.seuil),
      'progression', least(1, round((v_max_serie::numeric / r.seuil), 3)));
  end loop;

  -- Podium et Alpha d'un mois termine (classement general)
  declare
    v_podium timestamptz; v_alpha timestamptz;
  begin
    with mois as (
      select date_trunc('month', created_at at time zone 'Europe/Paris') as m, user_id, sum(distance_km) as km
      from balades
      where balade_eligible(distance_km, duree_secondes) and created_at < debut_mois_paris(0)
      group by 1, 2
    ), rangs as (
      select m, user_id, rank() over (partition by m order by km desc) as rg from mois
    )
    select min(m + interval '1 month') filter (where rg <= 3), min(m + interval '1 month') filter (where rg = 1)
    into v_podium, v_alpha
    from rangs where user_id = v_user;
    v_out := v_out
      || jsonb_build_object('code', 'podium_mois', 'categorie', 'podium', 'titre', 'Podium du mois', 'palier', 3,
           'obtenu', v_podium is not null, 'date', v_podium at time zone 'Europe/Paris', 'progression', case when v_podium is not null then 1 else 0 end)
      || jsonb_build_object('code', 'alpha_mois', 'categorie', 'podium', 'titre', 'Alpha du mois', 'palier', 1,
           'obtenu', v_alpha is not null, 'date', v_alpha at time zone 'Europe/Paris', 'progression', case when v_alpha is not null then 1 else 0 end);
  end;

  return v_out;
end;
$$;
grant execute on function mes_badges_balades(uuid) to authenticated;
