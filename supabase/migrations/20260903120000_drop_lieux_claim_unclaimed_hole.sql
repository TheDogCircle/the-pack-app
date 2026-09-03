-- Faille RLS critique : la policy "lieux_claim_unclaimed" permettait a N'IMPORTE QUEL
-- utilisateur connecte (meme un simple compte particulier, pas besoin d'etre "pro") de
-- s'auto-assigner manager_user_id sur N'IMPORTE QUEL lieu non revendique (manager_user_id
-- IS NULL) via un appel REST direct (PATCH sur /rest/v1/lieux), sans passer par le flux
-- de revendication securise (KBIS + verification admin, cf lieu_claims). Pire : son
-- with_check valait `true`, sans aucune restriction sur les colonnes modifiees -- un
-- attaquant aurait pu aussi changer nom/adresse/actif/premium/certifie/kbis_url de la
-- fiche au passage.
--
-- Aucun code client legitime ne s'appuyait dessus : pro.html n'ecrit jamais manager_user_id
-- par UPDATE (seulement par INSERT pour une nouvelle fiche, deja couvert par
-- lieux_insert_pro/allow_anon_insert_pro), et passe par un insert dans lieu_claims pour
-- revendiquer une fiche existante. admin.html ecrit manager_user_id via les policies
-- admin_* (cle anon + session admin), pas via celle-ci. C'est un reliquat d'un ancien
-- flux d'auto-revendication anterieur au KBIS obligatoire, jamais nettoye.

drop policy if exists "lieux_claim_unclaimed" on lieux;
