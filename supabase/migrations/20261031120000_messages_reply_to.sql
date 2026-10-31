-- Messagerie : repondre a un message precis (comme sur Instagram).
-- Les policies RLS existantes sur messages portent sur la ligne entiere
-- (insert : user_id = auth.uid() + membre de la conversation ; select : membre
-- de la conversation ; pas d'update) : elles couvrent donc aussi reply_to_id.

alter table public.messages
  add column if not exists reply_to_id uuid
  references public.messages(id) on delete set null;

create index if not exists messages_reply_to_id_idx
  on public.messages (reply_to_id) where reply_to_id is not null;

-- On ne peut citer qu'un message de la meme conversation (sinon on pourrait
-- referencer l'id d'un message d'une conversation dont on n'est pas membre).
create or replace function public.messages_check_reply_to()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'reply_to_id doit referencer un message de la meme conversation'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_check_reply_to on public.messages;
create trigger trg_messages_check_reply_to
  before insert or update of reply_to_id on public.messages
  for each row execute function public.messages_check_reply_to();
