-- Fiche d'un lieu (CarteScreen.openFiche) : photos (likes, auteur), photos de
-- posts tagues, avis (auteur), mon avis et mon favori en UNE requete.
-- Avant : 3 vagues de requetes successives (1 a 2 s sur le serveur actuel).
-- SECURITY INVOKER : les regles de visibilite (RLS) habituelles s'appliquent.

create or replace function fiche_lieu_contenu(p_lieu uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'photos', coalesce((
      select jsonb_agg(x order by x.created_at) from (
        select p.id, p.url, p.nom_chien, p.created_at,
               (select count(*) from photo_likes l where l.photo_id = p.id) likes,
               exists (select 1 from photo_likes l where l.photo_id = p.id and l.user_id = auth.uid()) liked,
               (select case when pr.username is not null then '@' || pr.username else pr.prenom end from profils pr where pr.id = p.user_id) auteur
        from photos p where p.lieu_id = p_lieu
        order by p.created_at limit 20
      ) x), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(y) from (
        select c.id, c.image_url,
               (select case when pr.username is not null then '@' || pr.username else pr.prenom end from profils pr where pr.id = c.user_id) auteur
        from community_posts c
        where c.lieu_id = p_lieu and c.hidden = false and c.image_url is not null
        order by c.created_at desc limit 10
      ) y), '[]'::jsonb),
    'avis', coalesce((
      select jsonb_agg(z order by z.created_at desc) from (
        select a.id, a.note, a.commentaire, a.created_at, a.reponse_pro,
               coalesce(pr.prenom, 'Membre') prenom, pr.username, pr.ambassadeur
        from avis a left join profils pr on pr.id = a.user_id
        where a.lieu_id::text = p_lieu::text
        order by a.created_at desc limit 8
      ) z), '[]'::jsonb),
    'mon_avis', (select jsonb_build_object('note', a.note, 'commentaire', a.commentaire)
                 from avis a where a.lieu_id::text = p_lieu::text and a.user_id::text = auth.uid()::text limit 1),
    'mon_favori', (select coalesce(f.liste, 'favori') from favoris f where f.lieu_id = p_lieu and f.user_id = auth.uid() limit 1)
  );
$$;

grant execute on function fiche_lieu_contenu(uuid) to anon, authenticated;
notify pgrst, 'reload schema';

-- Interrupteur "photos allegees" (src/lib/imagesLegeres.ts) : a passer a true
-- une fois les Transformations d'images Cloudflare activees sur le domaine.
insert into app_settings (key, value) values ('images_reduites', 'false'::jsonb)
on conflict (key) do nothing;
