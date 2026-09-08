-- Journal d'interactions daté pour le pipeline B2B (candidatures, revendications de
-- lieu, devis, partenaires/lieux). Remplace le champ note_admin unique (qui s'ecrase a
-- chaque mise a jour) par un historique append-only consultable dans la fiche detail
-- 360 degres d'admin.html.
create table if not exists crm_notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null, -- 'candidature' | 'lieu_claim' | 'devis' | 'partenaire' | 'lieu'
  entity_id uuid not null,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists crm_notes_entity_idx on crm_notes(entity_type, entity_id, created_at desc);

alter table crm_notes enable row level security;
create policy crm_notes_admin_all on crm_notes for all using (is_admin_user()) with check (is_admin_user());
