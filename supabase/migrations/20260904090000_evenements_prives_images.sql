-- Photos multiples pour un evenement prive (mobile). Le web continue a utiliser
-- image_url seul (deja existant), coherent avec le formulaire public equivalent.
alter table evenements_prives add column if not exists images text[];
