-- Facture Google Cloud : l'app et le site redemandent une photo a Google
-- (Text Search, payant) quand le lien en cache a expire ou qu'un lieu n'a pas
-- encore de photo, puis tentent d'enregistrer le resultat dans
-- lieux.google_photo_url. Mais seuls les admins et le gerant du lieu ont le
-- droit de modifier lieux (RLS) : l'enregistrement echouait sans bruit et la
-- recherche payante etait relancee a chaque affichage, pour chaque utilisateur.
--
-- Cette fonction permet a tout utilisateur (connecte ou non) de memoriser
-- UNIQUEMENT ce champ, et seulement avec une valeur sure :
--   'none' = deja cherche, Google n'a pas de photo pour ce lieu (meme
--            convention que le site et l'edge function cache-lieu-photo)
--   un lien de photo de la Places API (places.googleapis.com/v1/places/...)

create or replace function memoriser_photo_google(p_lieu uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_url is null then return; end if;
  if p_url <> 'none' and (
       p_url !~ '^https://places\.googleapis\.com/v1/places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+/media\?'
       or length(p_url) > 1200
     ) then
    return;
  end if;
  -- Ne touche jamais une photo deja re-hebergee chez nous (Storage / R2) :
  -- seulement un lieu jamais cherche, ou un lien Google (expire) a rafraichir.
  update lieux set google_photo_url = p_url
  where id = p_lieu
    and (google_photo_url is null or google_photo_url like 'https://places.googleapis.com/%');
end;
$$;

revoke all on function memoriser_photo_google(uuid, text) from public;
grant execute on function memoriser_photo_google(uuid, text) to anon, authenticated;
