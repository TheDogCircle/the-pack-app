-- Parrainage, ajustements pour le site (thepacklameute.fr) :
--
-- 1. rejoindre.html affiche "Marie & Albus t'invite" a un visiteur non
--    connecte : verifier_code_parrainage devient accessible a anon. Avant,
--    `p.id <> auth.uid()` valait null sans session et ne renvoyait rien.
--    N'expose que prenom + nom du chien, deja publics sur profil-public.html.
--
-- 2. Le profil web ne demande ni nom ni date de naissance : un filleul inscrit
--    uniquement sur le site restait 'en_attente' pour toujours. Profil complet
--    = prenom + nom du chien, renseignes sur l'app comme sur le site.

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
    and p.id is distinct from auth.uid();
$$;
grant execute on function verifier_code_parrainage(text) to anon, authenticated;

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
      and nullif(trim(nom_chien), '') is not null
  );
$$;

-- Le trigger de validation doit aussi se declencher quand le site enregistre
-- le profil (upsert prenom / nom_chien) : deja couvert par
-- "after update of prenom, nom, date_naissance_humain, nom_chien".

-- Rattrapage des parrainages deja en attente qui remplissent le nouveau critere
select valider_parrainage(filleul_id) from parrainages where statut = 'en_attente';
