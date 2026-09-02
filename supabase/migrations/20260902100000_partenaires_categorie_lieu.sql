-- Categorisation des partenaires (jusque-la "secteur" existait uniquement sur
-- candidatures_partenaires et n'etait jamais reporte sur la fiche finale ni
-- utilisable comme filtre public). Ajoute aussi le necessaire pour rattacher
-- un partenaire "Education & Promenade" fixe (educateur avec un local) a une
-- fiche lieux existante, en plus du lieu_id deja utilise pour ce rattachement.

alter table candidatures_partenaires add column if not exists categorie text
  check (categorie is null or categorie in ('alimentation', 'mode_accessoires', 'bien_etre_toilettage', 'veterinaire', 'education_promenade', 'autre'));
alter table candidatures_partenaires add column if not exists structure_fixe boolean;
alter table candidatures_partenaires add column if not exists adresse text;
alter table candidatures_partenaires add column if not exists ville text;

alter table partenaires add column if not exists categorie text
  check (categorie is null or categorie in ('alimentation', 'mode_accessoires', 'bien_etre_toilettage', 'veterinaire', 'education_promenade', 'autre'));
