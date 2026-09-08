-- Verifie les accuses de livraison Expo toutes les 30 minutes (cf edge function
-- check-notification-receipts). Meme pattern que les autres cron deja en place
-- (dog-birthday-notifications-daily, event-reminders-daily, event-proximity-reminders-daily).
select cron.schedule(
  'check-notification-receipts-30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://rdioupfyinxcmjascmcb.supabase.co/functions/v1/check-notification-receipts',
    headers := jsonb_build_object(
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkaW91cGZ5aW54Y21qYXNjbWNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM1MDYsImV4cCI6MjA5MDQ2OTUwNn0.1IU-U5wfWMe_7gH98a6P9ClXAuJgChn0lm6Bva9sSwg',
      'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkaW91cGZ5aW54Y21qYXNjbWNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM1MDYsImV4cCI6MjA5MDQ2OTUwNn0.1IU-U5wfWMe_7gH98a6P9ClXAuJgChn0lm6Bva9sSwg',
      'Content-Type', 'application/json'
    )
  );
  $$
);
