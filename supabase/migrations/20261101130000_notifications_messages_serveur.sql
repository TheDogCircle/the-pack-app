-- Messagerie : notifications push envoyees par le serveur (et non plus par le
-- telephone de l'expediteur, une par une, perdues si l'app se ferme).
--
-- A chaque nouveau message marque notif_serveur = true (les nouvelles versions de
-- l'app ; les anciennes continuent d'envoyer elles-memes, sans doublon), un trigger
-- prepare les notifications des autres membres et les poste a l'API Expo via pg_net
-- (envoi asynchrone apres validation, un echec n'empeche jamais le message).
--
-- Regles :
--  - membres en sourdine ou ayant coupe les notifications de messages : rien ;
--  - message direct : une notification par message ;
--  - groupe : regroupement. Apres une notification, les messages des 10 minutes
--    suivantes ne sonnent pas (tant que la personne n'a pas ouvert la discussion) ;
--    le message suivant apres ce delai envoie "N nouveaux messages · Prenom : ...".
--    Si la personne a lu entre-temps, on repart de zero ;
--  - pastille de l'icone de l'app = nombre de conversations non lues.
-- Les fils pro/client (lies a un lieu) gardent leur propre circuit : non concernes.

alter table public.messages
  add column if not exists notif_serveur boolean not null default false;

alter table public.conversation_members
  add column if not exists derniere_notif_at timestamptz,
  add column if not exists notifs_en_attente integer not null default 0;

-- Nombre de conversations non lues (meme regle que l'app : messages d'autres
-- membres plus recents que la derniere lecture, sur 14 jours maximum)
create or replace function public.badge_non_lus(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.conversation_members m
  join public.conversations c on c.id = m.conversation_id and c.actif
  where m.user_id = p_user
    and exists (
      select 1 from public.messages x
      where x.conversation_id = m.conversation_id and x.actif
        and x.user_id <> p_user
        and x.created_at > greatest(coalesce(m.last_read_at, '-infinity'::timestamptz), now() - interval '14 days')
    );
$$;
revoke all on function public.badge_non_lus(uuid) from public, anon, authenticated;

create or replace function public.notifier_nouveau_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv record;
  v_direct boolean;
  v_prenom text;
  v_titre text;
  v_texte text;
  v_corps text;
  v_badge integer;
  v_lu boolean;
  v_lot jsonb := '[]'::jsonb;
  r record;
  t record;
begin
  begin
    select c.id, c.nom, c.type, c.actif, c.lieu_id into v_conv
    from public.conversations c where c.id = new.conversation_id;
    if not found or not v_conv.actif or v_conv.lieu_id is not null then
      return null;
    end if;

    v_direct := v_conv.type = 'direct';
    select coalesce(nullif(trim(p.prenom), ''), 'Quelqu''un') into v_prenom
    from public.profils p where p.id = new.user_id;
    v_prenom := coalesce(v_prenom, 'Quelqu''un');
    v_titre := case
      when v_direct then v_prenom
      else coalesce(
        (select g.nom from public.groupes g where g.conversation_id = v_conv.id and g.actif limit 1),
        nullif(trim(v_conv.nom), ''),
        'Discussion de groupe')
    end;
    v_texte := case
      when new.image_url is not null and coalesce(trim(new.contenu), '') = '' then '📷 Photo'
      when length(coalesce(new.contenu, '')) > 140 then left(new.contenu, 139) || '…'
      else coalesce(new.contenu, '')
    end;

    for r in
      select m.id as mid, m.user_id, m.derniere_notif_at, m.notifs_en_attente, m.last_read_at
      from public.conversation_members m
      join public.profils p on p.id = m.user_id
      where m.conversation_id = new.conversation_id
        and m.user_id <> new.user_id
        and not m.muted
        and p.notif_messages is not false
    loop
      v_lu := r.derniere_notif_at is not null and r.last_read_at is not null
              and r.last_read_at > r.derniere_notif_at;

      if not v_direct and r.derniere_notif_at is not null
         and r.derniere_notif_at > now() - interval '10 minutes' and not v_lu then
        -- Regroupement : pas de nouvelle sonnerie, on compte
        update public.conversation_members
        set notifs_en_attente = notifs_en_attente + 1
        where id = r.mid;
        continue;
      end if;

      v_corps := case
        when r.notifs_en_attente > 0 and not v_lu
          then (r.notifs_en_attente + 1)::text || ' nouveaux messages · ' || v_prenom || ' : ' || v_texte
        when v_direct then v_texte
        else v_prenom || ' : ' || v_texte
      end;
      update public.conversation_members
      set derniere_notif_at = now(), notifs_en_attente = 0
      where id = r.mid;

      v_badge := public.badge_non_lus(r.user_id);
      for t in
        select distinct x.tok from (
          select d.token as tok from public.device_tokens d where d.user_id = r.user_id and d.enabled
          union
          select p.push_token from public.profils p where p.id = r.user_id and p.push_token is not null
        ) x
        where x.tok like 'ExponentPushToken[%' or x.tok like 'ExpoPushToken[%'
      loop
        v_lot := v_lot || jsonb_build_array(jsonb_build_object(
          'to', t.tok,
          'title', v_titre,
          'body', v_corps,
          'sound', 'default',
          'badge', v_badge,
          'data', jsonb_build_object('type', 'message', 'conversationId', new.conversation_id)
        ));
        if jsonb_array_length(v_lot) >= 100 then
          perform net.http_post(
            url := 'https://exp.host/--/api/v2/push/send',
            body := v_lot,
            headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
            timeout_milliseconds := 10000);
          v_lot := '[]'::jsonb;
        end if;
      end loop;
    end loop;

    if jsonb_array_length(v_lot) > 0 then
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        body := v_lot,
        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
        timeout_milliseconds := 10000);
    end if;
  exception when others then
    -- Jamais bloquer l'envoi d'un message a cause des notifications
    raise warning 'notifier_nouveau_message %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_notifier_nouveau_message on public.messages;
create trigger trg_notifier_nouveau_message
  after insert on public.messages
  for each row
  when (new.notif_serveur and new.actif is not false)
  execute function public.notifier_nouveau_message();
