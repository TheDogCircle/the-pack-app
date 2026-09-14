-- Securite (audit demande par Marine) : la RLS actuelle sur `balades` autorisait
-- n'importe quel utilisateur connecte a supprimer les balades de n'importe qui
-- (balades_delete n'avait aucune condition sur user_id). Deja corrige en direct via
-- le SQL editor avant cette migration -- reappliquee ici pour que le fichier de
-- migrations reste la source de verite versionnee.
drop policy if exists balades_delete on balades;
create policy balades_delete on balades for delete using (auth.uid() = user_id);

-- Vie privee (feature demandee) : jusqu'ici, le trace GPS et les coordonnees exactes
-- de depart/arrivee d'une balade restaient visibles par tous quelle que soit la
-- visibilite choisie (l'app l'indiquait meme explicitement a l'utilisateur) --
-- probleme classique "Strava heatmap" : le point de depart d'une balade recurrente
-- revele quasi toujours l'adresse du domicile. Reglage global par utilisateur
-- (comme la zone de confidentialite Strava), off par defaut : active, il floute un
-- rayon de 200m autour du depart ET de l'arrivee sur toute future lecture publique
-- de ses balades (trace tronquee, coordonnees exactes masquees), pour tout le
-- monde SAUF lui-meme.
alter table profils add column if not exists masquer_depart_balade boolean not null default false;

create or replace function haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
  select 6371 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  ));
$$;

-- Remplace la lecture directe de `balades` (utilisee pour afficher les traces des
-- AUTRES membres sur la carte) : redige le trace + les extremites quand le
-- proprietaire a active masquer_depart_balade, sauf si l'appelant consulte ses
-- propres balades. SECURITY DEFINER pour pouvoir lire profils.masquer_depart_balade
-- de chaque auteur sans dependre des policies RLS de profils sur l'appelant.
create or replace function balades_carte(
  p_lat double precision, p_lng double precision,
  p_lat_delta double precision, p_lng_delta double precision
)
returns table (
  id uuid, user_id uuid, nom text, description text,
  depart_lat double precision, depart_lng double precision, depart_label text,
  arrivee_texte text, arrivee_lat double precision, arrivee_lng double precision,
  distance_km double precision, duree_secondes integer, trace jsonb,
  ombragee boolean, eau_chemin boolean, fontaine_eau boolean,
  sans_laisse boolean, evite_routes boolean, sol_naturel boolean,
  created_at timestamptz, prenom text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  r record;
  masque boolean;
  real_dep_lat double precision; real_dep_lng double precision;
  real_arr_lat double precision; real_arr_lng double precision;
  filtered jsonb;
  pt jsonb;
  plat double precision; plng double precision;
begin
  for r in
    select b.*, p.prenom as author_prenom, coalesce(p.masquer_depart_balade, false) as author_masque
    from balades b
    join profils p on p.id = b.user_id
    where b.validee = true
      and b.depart_lat between p_lat - p_lat_delta and p_lat + p_lat_delta
      and b.depart_lng between p_lng - p_lng_delta and p_lng + p_lng_delta
    order by b.created_at desc
    limit 50
  loop
    masque := r.author_masque and r.user_id <> auth.uid();
    if not masque then
      id := r.id; user_id := r.user_id; nom := r.nom; description := r.description;
      depart_lat := r.depart_lat; depart_lng := r.depart_lng; depart_label := r.depart_label;
      arrivee_texte := r.arrivee_texte; arrivee_lat := r.arrivee_lat; arrivee_lng := r.arrivee_lng;
      distance_km := r.distance_km; duree_secondes := r.duree_secondes; trace := r.trace;
      ombragee := r.ombragee; eau_chemin := r.eau_chemin; fontaine_eau := r.fontaine_eau;
      sans_laisse := r.sans_laisse; evite_routes := r.evite_routes; sol_naturel := r.sol_naturel;
      created_at := r.created_at; prenom := r.author_prenom;
      return next;
      continue;
    end if;

    real_dep_lat := r.depart_lat; real_dep_lng := r.depart_lng;
    real_arr_lat := r.arrivee_lat; real_arr_lng := r.arrivee_lng;
    filtered := '[]'::jsonb;
    if r.trace is not null then
      for pt in select * from jsonb_array_elements(r.trace) loop
        plat := (pt->>'latitude')::double precision;
        plng := (pt->>'longitude')::double precision;
        if haversine_km(plat, plng, real_dep_lat, real_dep_lng) >= 0.2
           and (real_arr_lat is null or haversine_km(plat, plng, real_arr_lat, real_arr_lng) >= 0.2) then
          filtered := filtered || jsonb_build_array(pt);
        end if;
      end loop;
    end if;

    id := r.id; user_id := r.user_id; nom := r.nom; description := r.description;
    -- extremites masquees : pas de coordonnees exactes, seulement le trace tronque
    depart_lat := null; depart_lng := null; depart_label := r.depart_label;
    arrivee_texte := r.arrivee_texte; arrivee_lat := null; arrivee_lng := null;
    distance_km := r.distance_km; duree_secondes := r.duree_secondes; trace := filtered;
    ombragee := r.ombragee; eau_chemin := r.eau_chemin; fontaine_eau := r.fontaine_eau;
    sans_laisse := r.sans_laisse; evite_routes := r.evite_routes; sol_naturel := r.sol_naturel;
    created_at := r.created_at; prenom := r.author_prenom;
    return next;
  end loop;
end;
$$;

grant execute on function balades_carte(double precision, double precision, double precision, double precision) to authenticated, anon;
