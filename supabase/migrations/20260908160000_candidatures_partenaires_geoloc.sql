-- Permet de geocoder l'adresse d'une candidature educateur (structure fixe) au moment
-- de la soumission plutot qu'a l'approbation admin -- evite les fiches bloquees en
-- attente pour cause de geocodage echoue tardif, et les coordonnees (0,0) erronees.
alter table candidatures_partenaires
  add column if not exists lat double precision,
  add column if not exists lng double precision;
