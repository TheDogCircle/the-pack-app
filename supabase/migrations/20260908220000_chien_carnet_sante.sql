-- Passeport / carnet de sante par chien : vaccins, vermifuges, antiparasitaires,
-- rdv veterinaires, pesees et notes libres, dans une seule table "timeline" plutot
-- que 4 tables separees -- un carnet de sante est fondamentalement une chronologie
-- d'evenements types, et une seule table simplifie a la fois l'affichage (tri par
-- date) et le futur cron de rappel (une seule requete sur date_rappel au lieu de
-- plusieurs). Les questions a poser au veterinaire sont une checklist vivante, pas
-- des evenements dates -- table separee.

alter table chiens add column if not exists photo_url text;
alter table chiens add column if not exists puce_identification text;
alter table chiens add column if not exists veterinaire_nom text;
alter table chiens add column if not exists veterinaire_telephone text;
alter table chiens add column if not exists veterinaire_adresse text;
alter table chiens add column if not exists sterilise boolean not null default false;
alter table chiens add column if not exists date_sterilisation date;

create table if not exists chien_carnet_entries (
  id uuid primary key default gen_random_uuid(),
  chien_id uuid not null references chiens(id) on delete cascade,
  type text not null check (type in ('vaccin', 'vermifuge', 'antiparasitaire', 'rdv_veto', 'pesee', 'note')),
  titre text,
  date date not null default current_date,
  date_rappel date,
  poids_kg numeric,
  taille_cm numeric,
  notes text,
  document_url text,
  rappel_envoye boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists chien_carnet_entries_chien_idx on chien_carnet_entries(chien_id, date desc);
create index if not exists chien_carnet_entries_rappel_idx on chien_carnet_entries(date_rappel) where date_rappel is not null and rappel_envoye = false;

alter table chien_carnet_entries enable row level security;
create policy "Users manage their own dog's carnet entries"
on chien_carnet_entries for all
using (exists (select 1 from chiens where chiens.id = chien_carnet_entries.chien_id and chiens.user_id = auth.uid()))
with check (exists (select 1 from chiens where chiens.id = chien_carnet_entries.chien_id and chiens.user_id = auth.uid()));

create table if not exists chien_questions_veto (
  id uuid primary key default gen_random_uuid(),
  chien_id uuid not null references chiens(id) on delete cascade,
  question text not null,
  reponse text,
  posee boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists chien_questions_veto_chien_idx on chien_questions_veto(chien_id, created_at desc);

alter table chien_questions_veto enable row level security;
create policy "Users manage their own dog's vet questions"
on chien_questions_veto for all
using (exists (select 1 from chiens where chiens.id = chien_questions_veto.chien_id and chiens.user_id = auth.uid()))
with check (exists (select 1 from chiens where chiens.id = chien_questions_veto.chien_id and chiens.user_id = auth.uid()));
