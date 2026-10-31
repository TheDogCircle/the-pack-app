-- Messages directs : un seul fil par paire de personnes.
--
-- Bug : find_or_create_dm cherchait un fil existant en excluant le type 'groupe',
-- mais creait ses fils sans type -> type par defaut 'groupe'. Il ne retrouvait donc
-- jamais rien et creait un nouveau fil a chaque fois. Effets de bord : le site
-- (qui ne cherche que type 'direct') les affichait comme des groupes, et la
-- policy cm_insert_groupe permettait a n'importe qui connaissant l'id de
-- s'ajouter a ces fils prives.
--
-- 1) les messages directs existants passent en type 'direct'
-- 2) les doublons actifs d'une meme paire sont fusionnes dans le fil le plus
--    ancien (messages deplaces, derniere lecture conservee), les autres fils sont
--    desactives (actif = false) : rien n'est supprime
-- 3) find_or_create_dm cherche et cree des fils 'direct'

-- 1) Retypage. Message direct = 2 membres, sans nom, sans lieu (pas un fil
--    pro/client), ni groupe public ni salon d'evenement.
update public.conversations c
set type = 'direct'
where c.nom is null
  and c.lieu_id is null
  and coalesce(c.type, 'groupe') = 'groupe'
  and not exists (select 1 from public.groupes g where g.conversation_id = c.id)
  and not exists (select 1 from public.evenements_prives e where e.conversation_id = c.id)
  and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2;

-- 2) Fusion des doublons actifs.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    with paires as (
      select c.id, c.created_at,
             least(a.user_id, b.user_id) as u1, greatest(a.user_id, b.user_id) as u2
      from public.conversations c
      join public.conversation_members a on a.conversation_id = c.id
      join public.conversation_members b on b.conversation_id = c.id and a.user_id < b.user_id
      where c.actif and c.type = 'direct'
        and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2
    ), classees as (
      select id, first_value(id) over (partition by u1, u2 order by created_at, id) as garde
      from paires
    )
    select id as doublon, garde from classees where id <> garde
  loop
    update public.conversation_members k
    set last_read_at = greatest(k.last_read_at, d.last_read_at),
        muted = k.muted or d.muted
    from public.conversation_members d
    where d.conversation_id = r.doublon
      and k.conversation_id = r.garde
      and k.user_id = d.user_id;

    update public.messages set conversation_id = r.garde where conversation_id = r.doublon;
    update public.conversations set actif = false where id = r.doublon;
    n := n + 1;
  end loop;
  raise notice 'messages directs : % doublon(s) fusionne(s)', n;
end $$;

-- 3) Ouvrir ou creer la conversation directe.
create or replace function public.find_or_create_dm(p_other_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_conv_id uuid;
begin
  if v_me is null or p_other_id is null or v_me = p_other_id then
    return null;
  end if;

  -- Deux appels simultanes pour la meme paire (double tap, les deux personnes
  -- en meme temps) ne doivent pas creer deux fils
  perform pg_advisory_xact_lock(hashtextextended(
    least(v_me, p_other_id)::text || ':' || greatest(v_me, p_other_id)::text, 0));

  select c.id into v_conv_id
  from public.conversations c
  where c.actif and c.type = 'direct'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = v_me)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_other_id)
    and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2
  order by c.created_at, c.id
  limit 1;

  if v_conv_id is not null then
    return v_conv_id;
  end if;

  insert into public.conversations (nom, type, created_by, actif)
  values (null, 'direct', v_me, true)
  returning id into v_conv_id;
  insert into public.conversation_members (conversation_id, user_id)
  values (v_conv_id, v_me), (v_conv_id, p_other_id);
  return v_conv_id;
end;
$$;

grant execute on function public.find_or_create_dm(uuid) to authenticated;
