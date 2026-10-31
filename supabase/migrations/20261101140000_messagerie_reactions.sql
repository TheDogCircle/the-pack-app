-- Messagerie : reactions emoji (appui long sur un message), a la place du seul coeur.
--
-- On reutilise message_likes (une reaction par personne et par message, contrainte
-- unique existante) avec une colonne emoji. Les anciennes versions de l'app, qui
-- inserent sans emoji, continuent de fonctionner : leur like vaut un coeur.

alter table public.message_likes
  add column if not exists emoji text not null default '❤️';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'message_likes_emoji_check') then
    alter table public.message_likes
      add constraint message_likes_emoji_check check (char_length(emoji) between 1 and 16);
  end if;
end $$;

-- Changer sa reaction (coeur -> rire...) : mise a jour de sa propre ligne, sur un
-- message d'une conversation dont on est membre (meme regle que l'insert).
drop policy if exists message_likes_update_own on public.message_likes;
create policy message_likes_update_own on public.message_likes
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      join public.conversation_members cm on cm.conversation_id = m.conversation_id
      where m.id = message_likes.message_id and cm.user_id = auth.uid()
    )
  );

-- Reactions en direct : la table n'etait pas publiee dans Realtime (les ecouteurs
-- de l'app ne recevaient donc jamais rien). Insert / update sont filtres par la RLS.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_likes'
  ) then
    alter publication supabase_realtime add table public.message_likes;
  end if;
end $$;
