-- Demandes de devis des partenaires (lieux et marques) : mise en avant hebdo,
-- notifications ciblées, promotion d'événement, ou demande sur mesure.

create table if not exists demandes_devis (
  id uuid primary key default gen_random_uuid(),
  lieu_id uuid references lieux(id) on delete set null,
  partenaire_id uuid references partenaires(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  type_demande text not null check (type_demande in ('mise_en_avant_hebdo', 'notifications_push', 'promotion_evenement', 'autre')),
  message text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'traite', 'refuse')),
  note_admin text,
  created_at timestamptz not null default now()
);

create index if not exists idx_demandes_devis_user on demandes_devis(user_id);
create index if not exists idx_demandes_devis_statut on demandes_devis(statut);

alter table demandes_devis enable row level security;

create policy demandes_devis_insert on demandes_devis
  for insert to authenticated with check (auth.uid() = user_id);

create policy demandes_devis_select_own on demandes_devis
  for select to authenticated using (auth.uid() = user_id);

create policy demandes_devis_admin on demandes_devis
  for all using (is_admin_user()) with check (is_admin_user());
