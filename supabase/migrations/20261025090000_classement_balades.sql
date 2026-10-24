-- Classement des balades de la semaine (lundi 0 h -> dimanche minuit, heure de Paris)
-- et stats perso. Calcule cote serveur pour que tout le monde voie le meme podium.
--
-- Balade eligible (anti-triche, en plus des filtres GPS de l'app) :
-- au moins 500 m, au moins 5 min, allure moyenne <= 12 km/h.
-- Les balades privees comptent dans les km (seul le total est affiche, jamais le trace).

create or replace function balade_eligible(p_distance_km double precision, p_duree_secondes integer)
returns boolean
language sql
immutable
as $$
  select coalesce(p_distance_km, 0) >= 0.5
     and coalesce(p_duree_secondes, 0) >= 300
     and p_distance_km / (p_duree_secondes / 3600.0) <= 12;
$$;

create or replace function debut_semaine_paris(p_decalage_semaines integer default 0)
returns timestamptz
language sql
stable
as $$
  select (date_trunc('week', now() at time zone 'Europe/Paris') - make_interval(weeks => p_decalage_semaines))
         at time zone 'Europe/Paris';
$$;

-- p_portee : 'tous' ou 'meute' (moi + les comptes que je suis)
create or replace function classement_balades_semaine(p_portee text default 'tous')
returns table (rang integer, user_id uuid, prenom text, nom_chien text, avatar_url text, km numeric, nb integer)
language sql
stable
security definer
set search_path = public
as $$
  with perimetre as (
    select auth.uid() as uid
    union
    select f.following_id from follows f
    where f.follower_id = auth.uid() and f.statut = 'accepte'
  ),
  totaux as (
    select b.user_id, sum(b.distance_km) as km, count(*)::integer as nb
    from balades b
    where b.created_at >= debut_semaine_paris(0)
      and balade_eligible(b.distance_km, b.duree_secondes)
      and (p_portee <> 'meute' or b.user_id in (select uid from perimetre))
    group by b.user_id
  )
  select (rank() over (order by t.km desc))::integer, t.user_id, p.prenom, p.nom_chien, p.avatar_url,
         round(t.km::numeric, 1), t.nb
  from totaux t
  join profils p on p.id = t.user_id
  order by t.km desc
  limit 50;
$$;
grant execute on function classement_balades_semaine(text) to authenticated;

-- Stats perso : semaine en cours, rang (tout le monde), semaines d'affilee, totaux
create or replace function mes_stats_balades()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi uuid := auth.uid();
  v_km numeric; v_nb integer; v_rang integer;
  v_serie integer := 0;
  i integer;
begin
  if v_moi is null then return null; end if;

  select coalesce(sum(distance_km), 0), count(*) into v_km, v_nb
  from balades
  where user_id = v_moi and created_at >= debut_semaine_paris(0)
    and balade_eligible(distance_km, duree_secondes);

  select c.rang into v_rang from classement_balades_semaine('tous') c where c.user_id = v_moi;

  -- Semaines d'affilee avec au moins une balade (la semaine en cours compte si deja faite,
  -- sinon on part de la semaine precedente pour ne pas casser la serie un lundi matin)
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
    'semaine_km', round(v_km, 1),
    'semaine_nb', v_nb,
    'rang', v_rang,
    'serie_semaines', v_serie,
    'total_km', (select round(coalesce(sum(distance_km), 0)::numeric, 1) from balades
                 where user_id = v_moi and balade_eligible(distance_km, duree_secondes)),
    'total_nb', (select count(*) from balades
                 where user_id = v_moi and balade_eligible(distance_km, duree_secondes))
  );
end;
$$;
grant execute on function mes_stats_balades() to authenticated;
