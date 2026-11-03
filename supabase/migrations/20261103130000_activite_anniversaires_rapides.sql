-- Ecrans Activite (coeur) et Anniversaires : une seule requete chacun.
-- Avant : 4 allers-retours pour l'Activite, dont un .in() avec TOUS les posts
-- de l'utilisateur (500+ pour un compte qui a cree beaucoup de lieux) ; 3
-- allers-retours pour les Anniversaires. Tout se fait maintenant cote serveur.
-- Les deux fonctions ne renvoient que ce qui concerne l'utilisateur connecte
-- (auth.uid()) : reactions a SES publications, SES abonnes, les chiens des
-- comptes qu'IL suit (abonnement accepte), soit ce que l'app lisait deja.

create or replace function mon_activite(p_limite integer default 150)
returns table (
  id text, type text, actor_id uuid, actor_prenom text, actor_avatar text,
  created_at timestamptz, thumbnail text, commentaire text, follow_statut text
)
language sql
stable
security definer
set search_path = public
as $$
  with moi as (select auth.uid() as uid),
  ev (id, type, actor_id, created_at, thumbnail, commentaire, follow_statut) as (
    select 'like_post_' || l.id, 'like_post', l.user_id, l.created_at,
           coalesce(p.images[1], p.image_url), null::text, null::text
    from community_post_likes l join community_posts p on p.id = l.post_id, moi
    where p.user_id = moi.uid and l.user_id <> moi.uid
    union all
    select 'like_photo_' || l.id, 'like_photo', l.user_id, l.created_at, ph.url, null, null
    from photo_likes l join photos ph on ph.id = l.photo_id, moi
    where ph.user_id = moi.uid and l.user_id <> moi.uid
    union all
    select 'comment_post_' || c.id, 'comment_post', c.user_id, c.created_at,
           coalesce(p.images[1], p.image_url), c.content, null
    from community_post_comments c join community_posts p on p.id = c.post_id, moi
    where p.user_id = moi.uid and c.user_id <> moi.uid
    union all
    select 'comment_photo_' || c.id, 'comment_photo', c.user_id, c.created_at, ph.url, c.content, null
    from photo_comments c join photos ph on ph.id = c.photo_id, moi
    where ph.user_id = moi.uid and c.user_id <> moi.uid
    union all
    select 'follow_' || f.id, 'follow', f.follower_id, f.created_at, null, null, f.statut
    from follows f, moi
    where f.following_id = moi.uid
  )
  select ev.id, ev.type, ev.actor_id, coalesce(pr.prenom, 'Un membre'), pr.avatar_url,
         ev.created_at, ev.thumbnail, ev.commentaire, ev.follow_statut
  from ev left join profils pr on pr.id = ev.actor_id
  order by ev.created_at desc
  limit least(greatest(coalesce(p_limite, 150), 1), 300);
$$;

revoke all on function mon_activite(integer) from public;
grant execute on function mon_activite(integer) to authenticated;

create or replace function anniversaires_suivis()
returns table (chien_id uuid, nom text, user_id uuid, prenom text, avatar_url text, date_naissance date)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.nom, c.user_id, pr.prenom, pr.avatar_url, c.date_naissance_parsed
  from follows f
  join chiens c on c.user_id = f.following_id and c.date_naissance_parsed is not null
  left join profils pr on pr.id = c.user_id
  where f.follower_id = auth.uid() and f.statut = 'accepte';
$$;

revoke all on function anniversaires_suivis() from public;
grant execute on function anniversaires_suivis() to authenticated;
