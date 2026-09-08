-- FIX AUDIT SECURITE (critique) : les champs sensibles (contact veto, puce
-- d'identification, sterilisation) avaient ete ajoutes directement sur `chiens`, qui a
-- une policy SELECT permissive pour les abonnes (utilisee par les anniversaires / la
-- bougie du feed). RLS s'applique par ligne, pas par colonne : ces champs etaient donc
-- lisibles par n'importe quel abonne du proprietaire du chien, pas seulement par lui.
-- On les sort dans une table dediee, avec la meme policy strictement owner-only que
-- chien_carnet_entries. photo_url reste sur `chiens` (non sensible).
create table if not exists chien_infos_privees (
  chien_id uuid primary key references chiens(id) on delete cascade,
  veterinaire_nom text,
  veterinaire_telephone text,
  veterinaire_adresse text,
  puce_identification text,
  sterilise boolean not null default false,
  date_sterilisation date,
  updated_at timestamptz not null default now()
);

alter table chien_infos_privees enable row level security;
create policy "Users manage their own dog's private info"
on chien_infos_privees for all
using (exists (select 1 from chiens where chiens.id = chien_infos_privees.chien_id and chiens.user_id = auth.uid()))
with check (exists (select 1 from chiens where chiens.id = chien_infos_privees.chien_id and chiens.user_id = auth.uid()));

-- Aucune donnee existante dans ces colonnes (verifie avant migration) : suppression
-- directe, pas de copie necessaire.
alter table chiens drop column if exists veterinaire_nom;
alter table chiens drop column if exists veterinaire_telephone;
alter table chiens drop column if exists veterinaire_adresse;
alter table chiens drop column if exists puce_identification;
alter table chiens drop column if exists sterilise;
alter table chiens drop column if exists date_sterilisation;

-- FIX AUDIT SECURITE (a corriger) : l'upload vers le bucket `avatars` n'est restreint
-- que par `auth.role() = 'authenticated'`, sans verification de propriete -- n'importe
-- quel utilisateur connecte pouvait ecraser la photo d'un chien qui n'est pas le sien.
-- Policies RESTRICTIVE : s'ajoutent en AND aux policies permissives existantes
-- (avatars_user_upload / avatars_user_update), donc n'affectent aucun autre usage du
-- bucket (avatars perso, explorateurs...) -- seul le prefixe chiens/<id>/... est
-- desormais verifie contre la propriete du chien. Suppose un chemin de la forme
-- chiens/<chienId>/photo.ext (chienId en segment de dossier, pas dans le nom de
-- fichier) pour pouvoir etre lu via storage.foldername().
create policy "chiens_photo_owner_only_insert"
on storage.objects as restrictive for insert
with check (
  bucket_id != 'avatars'
  or (storage.foldername(name))[1] != 'chiens'
  or exists (
    select 1 from chiens
    where chiens.id::text = (storage.foldername(name))[2]
      and chiens.user_id = auth.uid()
  )
);

create policy "chiens_photo_owner_only_update"
on storage.objects as restrictive for update
with check (
  bucket_id != 'avatars'
  or (storage.foldername(name))[1] != 'chiens'
  or exists (
    select 1 from chiens
    where chiens.id::text = (storage.foldername(name))[2]
      and chiens.user_id = auth.uid()
  )
);
