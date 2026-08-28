-- Colonne generee : parse "JJ/MM/AAAA" en vraie date, NULL si texte libre ("5 ans" etc.)
create or replace function parse_date_naissance(txt text) returns date
language plpgsql immutable as $$
begin
  if txt ~ '^\d{2}/\d{2}/\d{4}$' then
    return to_date(txt, 'DD/MM/YYYY');
  end if;
  return null;
exception when others then
  return null;
end;
$$;

alter table chiens add column if not exists date_naissance_parsed date
  generated always as (parse_date_naissance(date_naissance)) stored;

alter table profils add column if not exists notif_birthday boolean not null default true;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  k text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkaW91cGZ5aW54Y21qYXNjbWNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM1MDYsImV4cCI6MjA5MDQ2OTUwNn0.1IU-U5wfWMe_7gH98a6P9ClXAuJgChn0lm6Bva9sSwg';
begin
  perform cron.schedule(
    'dog-birthday-notifications-daily',
    '0 7 * * *',
    format(
      $f$select net.http_post(url := 'https://rdioupfyinxcmjascmcb.supabase.co/functions/v1/birthday-notifications', headers := jsonb_build_object('apikey', %L, 'Authorization', 'Bearer ' || %L, 'Content-Type', 'application/json'));$f$,
      k, k
    )
  );
end $$;
