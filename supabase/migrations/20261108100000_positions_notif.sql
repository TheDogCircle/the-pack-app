-- Notifications "nouveau lieu pres de toi" basees sur la position reelle
-- (approximative, ~1 km) du membre, et non plus sur le centre de la ville de
-- son profil. Table separee et privee : profils.lat/lng est lisible par les
-- autres membres (distance dans la liste des membres), la position reelle ne
-- doit pas l'etre. Lue uniquement par les fonctions serveur (service role).

create table if not exists positions_notif (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

alter table positions_notif enable row level security;
revoke all on positions_notif from anon;
grant select, insert, update, delete on positions_notif to authenticated;

drop policy if exists positions_notif_own on positions_notif;
create policy positions_notif_own on positions_notif for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';
