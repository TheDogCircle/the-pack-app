-- Messagerie : groupes prives fermes + ajout de membres par RPC.
--
-- Avant : la policy cm_insert_groupe laissait n'importe qui s'ajouter lui-meme a
-- toute conversation de type 'groupe' dont il connaissait l'id (groupes prives
-- compris). Desormais seuls les groupes publics (fiche active dans `groupes`)
-- sont rejoignables librement ; dans un groupe prive, ce sont le createur ou un
-- membre qui ajoutent des gens, via ajouter_membres_conversation().
-- (La policy conversation_members_insert -- le createur d'une conversation y
-- ajoute des membres -- est inchangee : creation de groupe, DM du site, etc.)

-- Groupe public rejoignable : fiche active, conversation active, et meme createur
-- des deux cotes (sinon n'importe qui pourrait creer une fiche `groupes` pointant
-- vers la conversation privee de quelqu'un d'autre pour la rendre "publique").
create or replace function public.conversation_rejoignable(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.groupes g
    join public.conversations c on c.id = g.conversation_id
    where g.conversation_id = p_conversation
      and g.actif and c.actif
      and g.created_by = c.created_by
  );
$$;
grant execute on function public.conversation_rejoignable(uuid) to authenticated;

drop policy if exists cm_insert_groupe on public.conversation_members;
create policy cm_insert_groupe on public.conversation_members
  for insert to authenticated
  with check (user_id = auth.uid() and public.conversation_rejoignable(conversation_id));

-- Ajouter des membres a un groupe (prive ou public) dont on est membre.
-- Pas pour les messages directs, salons d'evenement ou fils pro/client.
create or replace function public.ajouter_membres_conversation(p_conversation uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_n integer;
begin
  if v_me is null then
    raise exception 'non connecte' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation and c.actif
      and c.type = 'groupe' and c.lieu_id is null
  ) then
    raise exception 'conversation introuvable ou pas un groupe' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation and m.user_id = v_me
  ) then
    raise exception 'reserve aux membres du groupe' using errcode = '42501';
  end if;
  if coalesce(array_length(p_user_ids, 1), 0) > 50 then
    raise exception '50 personnes maximum a la fois' using errcode = '22023';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  select p_conversation, u
  from (select distinct unnest(p_user_ids) as u) x
  where u is not null and exists (select 1 from public.profils p where p.id = u)
  on conflict (conversation_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.ajouter_membres_conversation(uuid, uuid[]) from public, anon;
grant execute on function public.ajouter_membres_conversation(uuid, uuid[]) to authenticated;

-- find_or_create_dm : ignorer les fils pro/client lies a un lieu (l'espace pro du
-- site en cree en type 'direct' entre le pro et un client).
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

  perform pg_advisory_xact_lock(hashtextextended(
    least(v_me, p_other_id)::text || ':' || greatest(v_me, p_other_id)::text, 0));

  select c.id into v_conv_id
  from public.conversations c
  where c.actif and c.type = 'direct' and c.lieu_id is null
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
