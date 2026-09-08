-- Journal des envois de notifications push (une ligne par "campagne" -- un groupe de
-- messages identiques envoye a un ensemble de destinataires depuis une meme invocation
-- d'edge function, ex: "new_lieu" envoye aux membres proches lors de l'activation d'un
-- lieu). Permet de calculer portee/taux d'ouverture façon Instagram, par type de notif.
create table if not exists notifications_log (
  id uuid primary key default gen_random_uuid(),
  type text not null,               -- correspond a data.type utilise pour le routing dans l'app
  lieu_id uuid references lieux(id) on delete set null,
  target_id text,                   -- id generique (evenement, chien, etc. -- pas de FK unique possible)
  title text,
  body text,
  recipients_count int not null default 0,
  ticket_ids jsonb not null default '[]'::jsonb,   -- ids de receipt Expo, pour verification differee
  delivered_count int,
  failed_count int,
  receipts_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_log_type_created_idx on notifications_log(type, created_at desc);
create index if not exists notifications_log_lieu_idx on notifications_log(lieu_id) where lieu_id is not null;
create index if not exists notifications_log_receipts_pending_idx on notifications_log(created_at) where receipts_checked_at is null;

alter table notifications_log enable row level security;
create policy "notifications_log_admin_read" on notifications_log for select using (is_admin_user());
-- Aucune policy insert/update pour les clients : uniquement ecrit par les edge functions
-- via la cle service_role, qui contourne RLS.

-- Ouvertures de notifications (tap sur la notif cote app). Reliee au log d'envoi quand
-- disponible (notifLogId transmis dans le payload data), pour calculer le taux de clic.
create table if not exists notification_opens (
  id uuid primary key default gen_random_uuid(),
  notification_log_id uuid references notifications_log(id) on delete set null,
  notification_type text,
  user_id uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now()
);

create index if not exists notification_opens_log_idx on notification_opens(notification_log_id);

alter table notification_opens enable row level security;
create policy "notification_opens_admin_read" on notification_opens for select using (is_admin_user());
create policy "notification_opens_insert_own" on notification_opens for insert
  with check (auth.uid() is not null and (user_id is null or user_id = auth.uid()));
