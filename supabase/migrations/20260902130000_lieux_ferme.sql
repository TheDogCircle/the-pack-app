-- Distinct de `actif` (qui masque completement une fiche) : un lieu "ferme" reste
-- visible/trouvable (historique, avis, photos), mais badge comme ferme definitivement
-- et sans les CTA de contact/reservation -- pattern Google Maps "Definitivement ferme".
alter table lieux add column if not exists ferme boolean not null default false;
