create table if not exists public.daily_stats (
  day_key date primary key,
  total_hits bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_visitors (
  day_key date not null,
  user_id text not null,
  hit_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day_key, user_id)
);

create or replace function public.increment_moktak_hit(
  p_day_key date,
  p_user_id text,
  p_increment integer default 1
)
returns table (
  count bigint,
  global_total bigint,
  visitor_count bigint
)
language plpgsql
security definer
as $$
declare
  v_increment integer := greatest(coalesce(p_increment, 1), 1);
begin
  insert into public.daily_stats (day_key, total_hits)
  values (p_day_key, 0)
  on conflict (day_key) do nothing;

  insert into public.daily_visitors (day_key, user_id, hit_count)
  values (p_day_key, p_user_id, 0)
  on conflict (day_key, user_id) do nothing;

  update public.daily_visitors
  set hit_count = hit_count + v_increment,
      updated_at = now()
  where day_key = p_day_key
    and user_id = p_user_id;

  update public.daily_stats
  set total_hits = total_hits + v_increment,
      updated_at = now()
  where day_key = p_day_key;

  return query
  select
    dv.hit_count as count,
    ds.total_hits as global_total,
    (
      select count(*)
      from public.daily_visitors
      where day_key = p_day_key
    ) as visitor_count
  from public.daily_visitors dv
  join public.daily_stats ds
    on ds.day_key = dv.day_key
  where dv.day_key = p_day_key
    and dv.user_id = p_user_id;
end;
$$;
