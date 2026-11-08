-- Rattrapage : les lieux suggeres sans compte (submitted_by vide) et valides
-- ces 30 derniers jours n'avaient pas d'annonce dans le feed. Publiee au nom du
-- compte The Pack La Meute, a la date d'ajout du lieu (pas en tete du feed).
insert into community_posts (user_id, type, lieu_id, auto_generated, image_url, created_at)
select '28f8c781-f384-4fcd-89a2-6347e7ca352a', 'nouveau_lieu', l.id, true, null, l.created_at
from lieux l
where l.actif and l.created_at > now() - interval '30 days'
  and not exists (select 1 from community_posts c where c.lieu_id = l.id and c.type = 'nouveau_lieu');
