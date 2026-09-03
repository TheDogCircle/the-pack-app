-- Taux de commission personnalisable par etablissement (negociation au cas par cas,
-- ex : 10% pour un partenaire specifique au lieu des 20% par defaut). NULL = utilise
-- le taux global (app_settings.commission_rate, actuellement 20%) -- comportement
-- inchange pour tous les etablissements existants tant qu'aucun taux specifique n'est
-- renseigne.
alter table lieux add column if not exists commission_rate_percent numeric;

alter table lieux add constraint lieux_commission_rate_percent_check
  check (commission_rate_percent is null or (commission_rate_percent >= 0 and commission_rate_percent <= 100));

-- Lien d'affiliation fourni par certains partenaires (arrangement alternatif a la
-- commission Stripe Connect, pour un suivi manuel des ventes referees hors reservations
-- in-app). Champ de reference libre, non exploite automatiquement par l'application.
alter table lieux add column if not exists affiliate_link text;
