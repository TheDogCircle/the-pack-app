-- Fix : openBaladeById (deep-link direct vers une balade, ex depuis un lien partage
-- ou une notification) lisait encore la table `balades` directement, contournant
-- entierement la zone de confidentialite ajoutee dans balades_carte() -- un lien
-- partage vers une balade masquee revelait quand meme les coordonnees exactes.
-- Meme logique de redaction, en variante "par id" plutot que "par zone".
create or replace function balade_by_id(p_id uuid)
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
  filtered jsonb;
  pt jsonb;
  plat double precision; plng double precision;
begin
  select b.*, p.prenom as author_prenom, coalesce(p.masquer_depart_balade, false) as author_masque
  into r
  from balades b
  join profils p on p.id = b.user_id
  where b.id = p_id and b.validee = true;

  if not found then
    return;
  end if;

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
    return;
  end if;

  filtered := '[]'::jsonb;
  if r.trace is not null then
    for pt in select * from jsonb_array_elements(r.trace) loop
      plat := (pt->>'latitude')::double precision;
      plng := (pt->>'longitude')::double precision;
      if haversine_km(plat, plng, r.depart_lat, r.depart_lng) >= 0.2
         and (r.arrivee_lat is null or haversine_km(plat, plng, r.arrivee_lat, r.arrivee_lng) >= 0.2) then
        filtered := filtered || jsonb_build_array(pt);
      end if;
    end loop;
  end if;

  id := r.id; user_id := r.user_id; nom := r.nom; description := r.description;
  depart_lat := null; depart_lng := null; depart_label := r.depart_label;
  arrivee_texte := r.arrivee_texte; arrivee_lat := null; arrivee_lng := null;
  distance_km := r.distance_km; duree_secondes := r.duree_secondes; trace := filtered;
  ombragee := r.ombragee; eau_chemin := r.eau_chemin; fontaine_eau := r.fontaine_eau;
  sans_laisse := r.sans_laisse; evite_routes := r.evite_routes; sol_naturel := r.sol_naturel;
  created_at := r.created_at; prenom := r.author_prenom;
  return next;
end;
$$;

grant execute on function balade_by_id(uuid) to authenticated, anon;
