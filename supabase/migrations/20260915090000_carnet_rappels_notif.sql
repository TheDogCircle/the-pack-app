-- Notification push pour les rappels du carnet de sante (vaccin, vermifuge,
-- antiparasitaire, rdv veto) -- jusqu'ici date_rappel n'alimentait qu'un affichage
-- "A venir" dans l'app, sans notification (cf. commentaire dans la migration
-- initiale : "futur cron de rappel"). Meme convention opt-out que les autres
-- notif_* (defaut true).
alter table profils add column if not exists notif_carnet_rappel boolean not null default true;
