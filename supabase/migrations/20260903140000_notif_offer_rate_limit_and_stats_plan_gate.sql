-- 1. Anti-spam : notify-new-offer se declenchait a CHAQUE nouvelle prestation creee par
-- un pro, diffusant une notification push a tous les utilisateurs opt-in sans aucune
-- limite -- un partenaire pouvait creer N prestations d'affilee et spammer toute la
-- communaute N fois. On stocke la derniere diffusion par lieu pour appliquer un cooldown
-- cote edge function (create-payment-intent... pardon, notify-new-offer).
alter table lieux add column if not exists last_offer_notif_at timestamptz;

-- 2. Statistiques (vues/clics) : la page de tarifs de l'espace pro annonce explicitement
-- "Statistiques de visibilite" comme fonctionnalite payante (plan Essentiel 29e/mois et
-- plus), mais get_manager_stats ne verifiait que la propriete du lieu, pas le plan --
-- tout le monde y avait acces gratuitement, y compris le plan Starter gratuit. Le plan
-- 'partenaire' (espace marque) n'est pas vendu via cette meme grille Starter/Essentiel/Pro
-- (acces accorde par l'admin independamment du plan du lieu) donc reste non restreint ici.
create or replace function public.get_manager_stats(p_target_type text, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  is_owner boolean;
  lieu_plan text;
  result jsonb;
begin
  if p_target_type = 'lieu' then
    select (manager_user_id = auth.uid()), plan into is_owner, lieu_plan
    from lieux where id = p_target_id;
    is_owner := coalesce(is_owner, false);
  elsif p_target_type = 'partenaire' then
    select exists(select 1 from partenaires where id = p_target_id and manager_user_id = auth.uid()) into is_owner;
  else
    return null;
  end if;

  if not is_owner and not is_admin_user() then return null; end if;

  if p_target_type = 'lieu' and coalesce(lieu_plan, 'starter') = 'starter' and not is_admin_user() then
    return jsonb_build_object('plan_locked', true);
  end if;

  select jsonb_build_object(
    'total_views', (select count(*) from analytics_events where event_type = 'page_view' and target_type = p_target_type and target_id = p_target_id),
    'total_clicks', (select count(*) from analytics_events where event_type = 'click' and target_type = p_target_type and target_id = p_target_id),
    'clicks_by_action', (select coalesce(jsonb_object_agg(action, cnt), '{}'::jsonb) from (select action, count(*) as cnt from analytics_events where event_type = 'click' and target_type = p_target_type and target_id = p_target_id and action is not null group by action) c),
    'daily_30d', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'views', views, 'clicks', clicks) order by day), '[]'::jsonb) from (select created_at::date as day, count(*) filter (where event_type = 'page_view') as views, count(*) filter (where event_type = 'click') as clicks from analytics_events where target_type = p_target_type and target_id = p_target_id and created_at >= now() - interval '30 days' group by created_at::date) d)
  ) into result;

  return result;
end;
$function$;
