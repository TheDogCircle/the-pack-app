-- Deux failles RLS sur lieu_claims, dans le prolongement du fix precedent
-- (20260903120000_drop_lieux_claim_unclaimed_hole.sql) :
--
-- 1. lieu_claims_select_authenticated (SELECT, qual=true) laissait N'IMPORTE QUEL
--    utilisateur connecte lire TOUTES les revendications de TOUS les pros : email,
--    SIRET, chemin du KBIS de tout le monde. espace-pro.html filtre bien cote client
--    par .eq('user_id', currentUser.id), mais rien ne l'imposait cote RLS -- un appel
--    REST direct passait outre ce filtre applicatif.
--
-- 2. lieu_claims_update_authenticated (UPDATE, qual=true) laissait N'IMPORTE QUEL
--    utilisateur connecte modifier N'IMPORTE QUELLE revendication en attente, y compris
--    son user_id/user_email. Verifie qu'aucun code client legitime n'ecrit jamais dans
--    lieu_claims en dehors de sbAdmin (admin.html, deja couvert par admin_full_access) :
--    un utilisateur malveillant aurait pu reecrire le user_id d'une revendication
--    legitime en attente vers son propre compte AVANT validation admin, et se voir
--    ainsi attribuer manager_user_id sur la fiche a la place du vrai demandeur des que
--    l'admin clique "Approuver" (qui fait confiance a lieu_claims.user_id).

drop policy if exists "lieu_claims_select_authenticated" on lieu_claims;
create policy "lieu_claims_select_own" on lieu_claims
  for select
  using (user_id = auth.uid());

drop policy if exists "lieu_claims_update_authenticated" on lieu_claims;
-- Aucune policy UPDATE de remplacement pour les non-admins : personne ne doit pouvoir
-- modifier une revendication apres soumission (admin_full_access reste seule habilitee).
