-- Suivi des vues de page et des clics (web + mobile), pour piloter les stats
-- admin et donner de la visibilite aux partenaires sur leurs performances.

create table if not exists analytics_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('page_view', 'click')),
  page text not null,
  target_type text check (target_type in ('lieu', 'partenaire', 'post', 'event', null)),
  target_id uuid,
  action text,
  user_id uuid references auth.users(id) on delete set null,
  session_id text,
  platform text not null check (platform in ('web', 'ios', 'android')),
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_events_created on analytics_events(created_at);
create index if not exists idx_analytics_events_target on analytics_events(target_type, target_id);
create index if not exists idx_analytics_events_page on analytics_events(page, event_type);
create index if not exists idx_analytics_events_session on analytics_events(session_id);

alter table analytics_events enable row level security;

create policy "Tout le monde peut envoyer un evenement"
  on analytics_events for insert with check (true);

create policy admin_full_access on analytics_events
  for all using (is_admin_user()) with check (is_admin_user());

-- Stats agregees pour un partenaire ou un lieu, exposees uniquement a son
-- gestionnaire (jamais les lignes brutes) : vues, clics par action, tendance
-- sur 30 jours.
create or replace function get_manager_stats(p_target_type text, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  is_owner boolean;
  result jsonb;
begin
  if p_target_type = 'lieu' then
    select exists(select 1 from lieux where id = p_target_id and manager_user_id = auth.uid()) into is_owner;
  elsif p_target_type = 'partenaire' then
    select exists(select 1 from partenaires where id = p_target_id and manager_user_id = auth.uid()) into is_owner;
  else
    return null;
  end if;

  if not is_owner and not is_admin_user() then
    return null;
  end if;

  select jsonb_build_object(
    'total_views', (
      select count(*) from analytics_events
      where event_type = 'page_view' and target_type = p_target_type and target_id = p_target_id
    ),
    'total_clicks', (
      select count(*) from analytics_events
      where event_type = 'click' and target_type = p_target_type and target_id = p_target_id
    ),
    'clicks_by_action', (
      select coalesce(jsonb_object_agg(action, cnt), '{}'::jsonb) from (
        select action, count(*) as cnt from analytics_events
        where event_type = 'click' and target_type = p_target_type and target_id = p_target_id
          and action is not null
        group by action
      ) c
    ),
    'daily_30d', (
      select coalesce(jsonb_agg(jsonb_build_object('day', day, 'views', views, 'clicks', clicks) order by day), '[]'::jsonb)
      from (
        select
          created_at::date as day,
          count(*) filter (where event_type = 'page_view') as views,
          count(*) filter (where event_type = 'click') as clicks
        from analytics_events
        where target_type = p_target_type and target_id = p_target_id
          and created_at >= now() - interval '30 days'
        group by created_at::date
      ) d
    )
  ) into result;

  return result;
end;
$$;
