-- Badges de balade : l'ecran Badges affichait "Ton premier badge t'attend" meme
-- avec des balades eligibles. mes_badges_balades videait sa table temporaire
-- par "delete from _b;" -- refuse par l'extension safeupdate de Supabase sur
-- les appels API ("DELETE requires a WHERE clause") : l'RPC echouait depuis
-- l'app (jamais depuis le SQL editor, d'ou un calcul qui semblait juste).
-- Remplace par truncate, le reste de la fonction est inchange.

CREATE OR REPLACE FUNCTION public.mes_badges_balades(p_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := coalesce(p_user, auth.uid());
  v_total_km numeric; v_total_nb integer; v_max_km numeric; v_max_serie integer;
  v_out jsonb := '[]'::jsonb;
  r record;
begin
  if v_user is null then return '[]'::jsonb; end if;

  create temp table if not exists _b (created_at timestamptz, distance_km double precision, cum_km double precision, n integer) on commit drop;
  truncate _b;
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
$function$;
