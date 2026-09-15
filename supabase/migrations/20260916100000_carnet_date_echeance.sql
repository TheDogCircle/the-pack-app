-- Jusqu'ici seule la date de rappel calculee (echeance - delai de prevenance) etait
-- stockee : impossible d'afficher clairement "prochain vaccin a prendre le X" a
-- l'utilisateur (on ne connaissait que la date d'envoi de la notif, pas l'echeance
-- reelle). Stocke desormais les deux separement.
alter table chien_carnet_entries add column if not exists date_echeance date;
