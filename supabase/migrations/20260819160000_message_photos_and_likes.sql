-- Messages : photo optionnelle en plus (ou a la place) du texte.
alter table messages add column if not exists image_url text;

-- Likes sur les messages (facon Instagram) : une ligne par (message, utilisateur).
create table if not exists message_likes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

alter table message_likes enable row level security;

-- Lecture : uniquement les membres de la conversation du message concerne.
create policy "message_likes_select_members" on message_likes
  for select using (
    exists (
      select 1 from messages m
      join conversation_members cm on cm.conversation_id = m.conversation_id
      where m.id = message_likes.message_id and cm.user_id = auth.uid()
    )
  );

-- Ecriture : un membre de la conversation peut liker en son propre nom.
create policy "message_likes_insert_own" on message_likes
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from messages m
      join conversation_members cm on cm.conversation_id = m.conversation_id
      where m.id = message_likes.message_id and cm.user_id = auth.uid()
    )
  );

-- Suppression : uniquement son propre like (unlike).
create policy "message_likes_delete_own" on message_likes
  for delete using (user_id = auth.uid());
