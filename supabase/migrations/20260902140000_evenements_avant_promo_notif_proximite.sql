-- Mise en avant d'un evenement + code promo a utiliser sur le site de
-- l'organisateur (site_web existe deja et sert precisement ce cas : evenement
-- tiers ou l'inscription se fait hors app).
alter table evenements add column if not exists mise_en_avant boolean not null default false;
alter table evenements add column if not exists code_promo text;

-- Date de la derniere notification de proximite envoyee pour cet evenement,
-- pour piloter la cadence (1x/semaine puis tous les 5 jours a l'approche).
alter table evenements add column if not exists derniere_notif_proximite_at timestamptz;

alter table profils add column if not exists notif_event_reminder boolean not null default true;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  k text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkaW91cGZ5aW54Y21qYXNjbWNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM1MDYsImV4cCI6MjA5MDQ2OTUwNn0.1IU-U5wfWMe_7gH98a6P9ClXAuJgChn0lm6Bva9sSwg';
begin
  perform cron.schedule(
    'event-proximity-reminders-daily',
    '0 8 * * *',
    format(
      $f$select net.http_post(url := 'https://rdioupfyinxcmjascmcb.supabase.co/functions/v1/event-proximity-reminders', headers := jsonb_build_object('apikey', %L, 'Authorization', 'Bearer ' || %L, 'Content-Type', 'application/json'));$f$,
      k, k
    )
  );
end $$;
