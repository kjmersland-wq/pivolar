-- Pivolar: usage meter and budget. The owner's own AI spend is logged in `usage` and compared with a
-- budget kept in `user_settings`. Everything is limited to the signed-in user's own rows.

create table public.user_settings (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  -- Amount available for AI use, in US dollars. Null means no budget is set.
  budget_usd numeric check (budget_usd is null or (budget_usd >= 0 and budget_usd <= 100000)),
  -- 'total': a prepaid amount used up from budget_starts_at. 'month': a fresh budget each calendar month.
  budget_period text not null default 'total' check (budget_period in ('month', 'total')),
  budget_starts_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
revoke all on public.user_settings from anon;
grant select, insert, update on public.user_settings to authenticated;

create policy user_settings_select on public.user_settings for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy user_settings_insert on public.user_settings for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy user_settings_update on public.user_settings for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- Generated pictures are priced per picture, so they get their own kind.
alter table public.usage drop constraint if exists usage_kind_check;
alter table public.usage add constraint usage_kind_check
  check (kind in ('ai_input_tokens', 'ai_output_tokens', 'ai_image', 'build_seconds', 'storage_bytes', 'deploy'));

-- The app writes the owner's own usage rows with their session, so it needs no service key.
-- A user can only add rows for themselves, and cannot change or delete them.
grant insert on public.usage to authenticated;
create policy usage_insert on public.usage for insert to authenticated
  with check ((select auth.uid()) = owner_id);
