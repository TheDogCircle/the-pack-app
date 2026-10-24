-- Parrainage : un membre partage son code (ex. ALBUS-7K2) ou son pseudo, le filleul le saisit
-- a l'onboarding (ou dans son profil pendant 7 jours apres l'inscription) et
-- rejoint la meute de son parrain (follow mutuel).
--
-- Validation : le parrainage passe a 'valide' des que le profil du filleul est
-- complet (prenom, nom, date de naissance, nom du chien). Garde-fous anti-faux
-- comptes : au plus 3 validations par parrain sur 24 h glissantes (les suivantes
-- restent 'en_attente' et sont reprises par le cron horaire), et un admin peut
-- passer un parrainage a 'annule' depuis le dashboard.
--
-- Paliers (calcules, pas stockes) : 1 = Parrain, 5 = Chef de meute, 10 = Alpha.
--
-- Tout passe par des fonctions security definer : le client ne peut ecrire ni
-- profils.parraine_par, ni profils.code_parrainage, ni la table parrainages.

-- ── Colonnes profils ────────────────────────────────────────────────────────
alter table profils add column if not exists code_parrainage text;
alter table profils add column if not exists parraine_par uuid references profils(id) on delete set null;
create unique index if not exists profils_code_parrainage_key on profils (code_parrainage);

-- ── Table parrainages ───────────────────────────────────────────────────────
create table if not exists parrainages (
  id uuid primary key default gen_random_uuid(),
  parrain_id uuid not null references profils(id) on delete cascade,
  filleul_id uuid not null unique references profils(id) on delete cascade,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'valide', 'annule')),
  created_at timestamptz not null default now(),
  valide_le timestamptz,
  check (parrain_id <> filleul_id)
);
create index if not exists parrainages_parrain_idx on parrainages (parrain_id, statut);

alter table parrainages enable row level security;
drop policy if exists "parrainages_read_own" on parrainages;
create policy "parrainages_read_own" on parrainages for select
  using (auth.uid() = parrain_id or auth.uid() = filleul_id);
-- Pas de policy insert/update/delete : ecriture uniquement via les fonctions ci-dessous.

-- ── Generation du code ──────────────────────────────────────────────────────
-- Prefixe = nom du chien en majuscules sans accents ni espaces (6 lettres max),
-- suffixe = 3 caracteres sans 0/O/1/I pour eviter les confusions a la saisie.
create or replace function generer_code_parrainage(p_nom_chien text)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  prefixe text;
  candidat text;
  i int;
begin
  prefixe := upper(translate(coalesce(p_nom_chien, ''),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'));
  prefixe := left(regexp_replace(prefixe, '[^A-Z]', '', 'g'), 6);
  if length(prefixe) < 2 then prefixe := 'PACK'; end if;

  loop
    candidat := prefixe || '-';
    for i in 1..3 loop
      candidat := candidat || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from profils where code_parrainage = candidat);
  end loop;
  return candidat;
end;
$$;

-- ── Protection des colonnes + attribution automatique du code ───────────────
-- Les fonctions de ce fichier posent app.parrainage = 'on' pour ecrire
-- parraine_par ; un client authentifie qui tente de l'ecrire directement
-- (update/upsert sur profils) voit sa valeur silencieusement ignoree.
create or replace function profils_parrainage_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and coalesce(current_setting('app.parrainage', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.parraine_par := null;
      new.code_parrainage := null;
    else
      new.parraine_par := old.parraine_par;
      new.code_parrainage := old.code_parrainage;
    end if;
  end if;

  -- Code attribue des que le nom du chien est connu (fin d'onboarding)
  if new.code_parrainage is null and nullif(trim(new.nom_chien), '') is not null then
    new.code_parrainage := generer_code_parrainage(new.nom_chien);
  end if;
  return new;
end;
$$;

drop trigger if exists profils_parrainage_guard on profils;
create trigger profils_parrainage_guard
  before insert or update on profils
  for each row execute function profils_parrainage_guard();

-- Codes pour les comptes existants
update profils
set code_parrainage = generer_code_parrainage(nom_chien)
where code_parrainage is null and nullif(trim(nom_chien), '') is not null;

-- ── Validation ──────────────────────────────────────────────────────────────
create or replace function profil_complet(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profils
    where id = p_id
      and nullif(trim(prenom), '') is not null
      and nullif(trim(nom), '') is not null
      and nullif(trim(date_naissance_humain), '') is not null
      and nullif(trim(nom_chien), '') is not null
  );
$$;

-- Valide le parrainage en attente du filleul si son profil est complet et si
-- le parrain n'a pas atteint le plafond de 3 validations sur 24 h.
create or replace function valider_parrainage(p_filleul uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parrain uuid;
begin
  select parrain_id into v_parrain
  from parrainages
  where filleul_id = p_filleul and statut = 'en_attente';
  if not found then return false; end if;

  if not profil_complet(p_filleul) then return false; end if;

  if (select count(*) from parrainages
      where parrain_id = v_parrain and statut = 'valide'
        and valide_le > now() - interval '24 hours') >= 3 then
    return false;
  end if;

  update parrainages
  set statut = 'valide', valide_le = now()
  where filleul_id = p_filleul and statut = 'en_attente';
  return true;
end;
$$;
revoke execute on function valider_parrainage(uuid) from public, anon, authenticated;

-- Le profil peut etre complete apres la saisie du code (CompleteProfileModal)
create or replace function profils_valider_parrainage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform valider_parrainage(new.id);
  return null;
end;
$$;

drop trigger if exists profils_valider_parrainage on profils;
create trigger profils_valider_parrainage
  after update of prenom, nom, date_naissance_humain, nom_chien on profils
  for each row execute function profils_valider_parrainage();

-- Reprise horaire des parrainages bloques par le plafond journalier
select cron.schedule(
  'parrainages-reprise-horaire',
  '15 * * * *',
  $$ select valider_parrainage(filleul_id) from parrainages where statut = 'en_attente' $$
);

-- ── API client ──────────────────────────────────────────────────────────────
-- Le filleul peut saisir le code (ALBUS-7K2) ou le pseudo du parrain
-- (marie_et_rex ou @marie_et_rex), sans tenir compte de la casse.
create or replace function resoudre_code_parrainage(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from profils
  where code_parrainage = upper(ltrim(trim(p_code), '@'))
     or lower(username) = lower(ltrim(trim(p_code), '@'))
  order by (code_parrainage = upper(ltrim(trim(p_code), '@'))) desc
  limit 1;
$$;
revoke execute on function resoudre_code_parrainage(text) from public, anon, authenticated;

-- Verification en direct pendant la saisie (comme la dispo du pseudo).
create or replace function verifier_code_parrainage(p_code text)
returns table (prenom text, nom_chien text)
language sql
stable
security definer
set search_path = public
as $$
  select p.prenom, p.nom_chien
  from profils p
  where p.id = resoudre_code_parrainage(p_code)
    and p.id <> auth.uid();
$$;
grant execute on function verifier_code_parrainage(text) to authenticated;

-- Retour : 'valide' | 'en_attente' | 'code_inconnu' | 'soi_meme'
--        | 'deja_parraine' | 'delai_depasse' | 'boucle' | 'non_connecte'
create or replace function appliquer_code_parrainage(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := auth.uid();
  v_parrain uuid;
  v_inscrit timestamptz;
begin
  if v_moi is null then return 'non_connecte'; end if;

  v_parrain := resoudre_code_parrainage(p_code);
  if v_parrain is null then return 'code_inconnu'; end if;
  if v_parrain = v_moi then return 'soi_meme'; end if;

  if exists (select 1 from parrainages where filleul_id = v_moi)
     or exists (select 1 from profils where id = v_moi and parraine_par is not null) then
    return 'deja_parraine';
  end if;

  select created_at into v_inscrit from auth.users where id = v_moi;
  if v_inscrit < now() - interval '7 days' then return 'delai_depasse'; end if;

  -- Pas de parrainage croise (A parraine B, B parraine A)
  if exists (select 1 from profils where id = v_parrain and parraine_par = v_moi) then
    return 'boucle';
  end if;

  perform set_config('app.parrainage', 'on', true);
  update profils set parraine_par = v_parrain where id = v_moi;
  perform set_config('app.parrainage', '', true);

  insert into parrainages (parrain_id, filleul_id) values (v_parrain, v_moi);

  -- Le filleul rejoint la meute : follow mutuel accepte
  insert into follows (follower_id, following_id, statut)
  select v_moi, v_parrain, 'accepte'
  where not exists (select 1 from follows where follower_id = v_moi and following_id = v_parrain);
  insert into follows (follower_id, following_id, statut)
  select v_parrain, v_moi, 'accepte'
  where not exists (select 1 from follows where follower_id = v_parrain and following_id = v_moi);

  if valider_parrainage(v_moi) then return 'valide'; end if;
  return 'en_attente';
end;
$$;
grant execute on function appliquer_code_parrainage(text) to authenticated;

-- Tout ce dont la carte "Ma meute" du profil a besoin, en un appel.
create or replace function mon_parrainage()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid := auth.uid();
  v_code text;
  v_nom_chien text;
  v_parraine_par uuid;
  v_inscrit timestamptz;
  v_nb_valides int;
begin
  if v_moi is null then return null; end if;

  select code_parrainage, nom_chien, parraine_par
  into v_code, v_nom_chien, v_parraine_par
  from profils where id = v_moi;

  if v_code is null then
    v_code := generer_code_parrainage(v_nom_chien);
    perform set_config('app.parrainage', 'on', true);
    update profils set code_parrainage = v_code where id = v_moi;
    perform set_config('app.parrainage', '', true);
  end if;

  select created_at into v_inscrit from auth.users where id = v_moi;
  select count(*) into v_nb_valides from parrainages where parrain_id = v_moi and statut = 'valide';

  return jsonb_build_object(
    'code', v_code,
    'username', (select username from profils where id = v_moi),
    'nb_valides', v_nb_valides,
    'nb_en_attente', (select count(*) from parrainages where parrain_id = v_moi and statut = 'en_attente'),
    'palier', case when v_nb_valides >= 10 then 3 when v_nb_valides >= 5 then 2 when v_nb_valides >= 1 then 1 else 0 end,
    'peut_saisir', v_parraine_par is null and v_inscrit >= now() - interval '7 days',
    'parrain', (select jsonb_build_object('id', p.id, 'prenom', p.prenom, 'username', p.username, 'avatar_url', p.avatar_url)
                from profils p where p.id = v_parraine_par),
    'filleuls', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'prenom', p.prenom, 'username', p.username,
               'avatar_url', p.avatar_url, 'nom_chien', p.nom_chien, 'statut', pa.statut)
             order by pa.created_at desc)
      from parrainages pa join profils p on p.id = pa.filleul_id
      where pa.parrain_id = v_moi and pa.statut <> 'annule'
    ), '[]'::jsonb)
  );
end;
$$;
grant execute on function mon_parrainage() to authenticated;

-- Compteur public (badge de palier sur les profils des autres)
create or replace function nb_filleuls(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from parrainages where parrain_id = p_user and statut = 'valide';
$$;
grant execute on function nb_filleuls(uuid) to authenticated, anon;
