-- Permet de rattacher le veterinaire du carnet de sante a une fiche existante de la
-- carte (cat='veto') plutot que de ressaisir nom/telephone/adresse a la main -- soit
-- depuis le carnet (recherche parmi les fiches veto), soit depuis la fiche veto elle
-- meme sur la carte (bouton "Mon veto referent"). Les champs texte existants restent
-- la source affichee (compatibilite avec les vetos non presents sur la carte) ; ce
-- champ est juste le lien optionnel vers la fiche d'origine.
alter table chien_infos_privees add column if not exists veterinaire_lieu_id uuid references lieux(id) on delete set null;
