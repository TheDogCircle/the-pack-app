-- Heure du rendez-vous veto (optionnelle) -- jusqu'ici seule une date sans heure etait
-- enregistree, insuffisant pour l'encadre "Prochain RDV veto le X a XhXX" sur le profil.
alter table chien_carnet_entries add column if not exists heure_rdv time;
