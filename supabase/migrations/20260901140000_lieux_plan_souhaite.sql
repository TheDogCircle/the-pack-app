-- Formule souhaitee choisie a l'inscription (intention, pas la formule payee/active
-- qui reste dans lieux.plan) : permet a l'equipe de savoir quoi proposer/relancer.
alter table lieux add column if not exists plan_souhaite text
  check (plan_souhaite is null or plan_souhaite in ('starter', 'essentiel', 'pro', 'premium'));
