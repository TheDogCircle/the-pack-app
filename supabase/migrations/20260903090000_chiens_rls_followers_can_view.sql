-- La seule policy sur chiens etait "Users manage their own dogs" (ALL, auth.uid() =
-- user_id) : personne ne pouvait jamais lire le chien de quelqu'un d'autre, meme en
-- le suivant. AnniversairesScreen et la bougie du feed (qui lisent les chiens des
-- gens suivis) ont donc toujours renvoye une liste vide côté client, silencieusement
-- -- alors que les notifications push fonctionnaient (edge function en service_role,
-- qui contourne RLS). Ajoute une policy SELECT additionnelle (les policies
-- permissives se combinent en OR, celle-ci ne restreint rien de l'existante) pour
-- les chiens des personnes suivies.
create policy "Followers can view dogs of people they follow"
on chiens
for select
using (
  exists (
    select 1 from follows
    where follows.following_id = chiens.user_id
      and follows.follower_id = auth.uid()
      and follows.statut = 'accepte'
  )
);
