-- Pivolar quotas: hard stops on the server, so a budget cannot be skipped by calling the API directly.
--  1. reserve_usage: before an AI request starts, an amount is set aside against the budget. Done in
--     one step under a lock, so many requests at once cannot together spend more than is left.
--  2. rate_limit: a counter per signed-in user and route.
--  3. global_spend_today: one number for the whole service, for a daily emergency cap.
-- Reservations are rows in `usage` with kind 'ai_reserved'. They are removed when the request ends
-- and ignored after 15 minutes, so a request that dies does not hold money forever.

alter table public.usage drop constraint if exists usage_kind_check;
alter table public.usage add constraint usage_kind_check
  check (kind in ('ai_input_tokens', 'ai_output_tokens', 'ai_image', 'ai_reserved', 'build_seconds', 'storage_bytes', 'deploy'));

-- Until now usage rows could not be deleted. Only a user's own reservations can be.
grant delete on public.usage to authenticated;
create policy usage_delete_reserved on public.usage for delete to authenticated
  using ((select auth.uid()) = owner_id and kind = 'ai_reserved');

-- Sets aside up to p_estimate dollars. With a budget, the amount is cut down to what is left, and
-- nothing is granted when less than p_min is left. Returns { ok, id, granted, spent, held }.
create function public.reserve_usage(
  p_estimate numeric,
  p_budget numeric,
  p_since timestamptz,
  p_min numeric default 0.02
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  spent numeric;
  held numeric;
  granted numeric;
  new_id bigint;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_estimate is null or p_estimate <= 0 or p_estimate > 1000 then raise exception 'bad estimate'; end if;

  -- One request at a time per user decides, so the sums below cannot change underneath it.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 42));

  select coalesce(sum(estimated_cost_usd), 0) into spent
    from public.usage
    where owner_id = uid and created_at >= p_since and kind in ('ai_input_tokens', 'ai_output_tokens', 'ai_image');
  select coalesce(sum(estimated_cost_usd), 0) into held
    from public.usage
    where owner_id = uid and kind = 'ai_reserved' and created_at > now() - interval '15 minutes';

  granted := p_estimate;
  if p_budget is not null then
    granted := least(p_estimate, p_budget - spent - held);
    if granted < p_min then
      return jsonb_build_object('ok', false, 'granted', 0, 'spent', spent, 'held', held);
    end if;
  end if;

  insert into public.usage (owner_id, kind, units, estimated_cost_usd)
    values (uid, 'ai_reserved', 1, granted)
    returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'granted', granted, 'spent', spent, 'held', held);
end;
$$;

create function public.release_reservation(p_id bigint) returns void
language sql security invoker set search_path = ''
as $$
  delete from public.usage where id = p_id and owner_id = (select auth.uid()) and kind = 'ai_reserved';
$$;

-- Counters per user and route in fixed windows. The caller's id is part of the key and cannot be
-- chosen, so one user cannot use up another's allowance.
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create function public.rate_limit(p_route text, p_window_seconds integer, p_max integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_route is null or char_length(p_route) not between 1 and 40 then raise exception 'bad route'; end if;
  if p_window_seconds not between 1 and 86400 or p_max not between 1 and 100000 then raise exception 'bad limit'; end if;

  insert into public.rate_limits as r (key, window_start, hits)
    values (uid::text || ':' || p_route, now(), 1)
    on conflict (key) do update set
      hits = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
      window_start = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
    returning r.hits into n;

  -- Old counters are cleared now and then, so the table stays small.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return n <= p_max;
end;
$$;
revoke all on function public.rate_limit(text, integer, integer) from public;
grant execute on function public.rate_limit(text, integer, integer) to authenticated;

-- What the whole service has spent on AI since midnight (Norwegian time), and nothing else about anyone.
create function public.global_spend_today() returns numeric
language sql security definer set search_path = ''
as $$
  select coalesce(sum(estimated_cost_usd), 0)
    from public.usage
    where kind in ('ai_input_tokens', 'ai_output_tokens', 'ai_image')
      and created_at >= date_trunc('day', now() at time zone 'Europe/Oslo') at time zone 'Europe/Oslo';
$$;
revoke all on function public.global_spend_today() from public;
grant execute on function public.global_spend_today() to authenticated;
