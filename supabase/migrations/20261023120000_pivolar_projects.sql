-- Pivolar phase 1: server-side projects owned by a signed-in user.
-- Every table has row-level security. A user can only reach rows that belong to them, and the
-- server checks ownership again on every request. Nothing here is readable by the anon role.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  framework text check (char_length(framework) <= 60),
  import_info jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_idx on public.projects (owner_id, updated_at desc);

create table public.project_files (
  project_id uuid not null references public.projects (id) on delete cascade,
  path text not null check (char_length(path) between 1 and 300 and path not like '%..%'),
  content text not null check (char_length(content) <= 1000000),
  updated_at timestamptz not null default now(),
  primary key (project_id, path)
);

-- Chat history, direct edits and publish info of a project, kept as the app uses them today.
create table public.project_state (
  project_id uuid primary key references public.projects (id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  edits jsonb not null default '[]'::jsonb,
  publish jsonb,
  updated_at timestamptz not null default now()
);

-- Sensitive actions. Written by the server with the service role, readable by the owner.
create table public.audit_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_owner_idx on public.audit_log (owner_id, created_at desc);

-- AI and infrastructure usage, for quotas and cost estimates. Estimates, not invoices.
create table public.usage (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  kind text not null check (kind in ('ai_input_tokens', 'ai_output_tokens', 'build_seconds', 'storage_bytes', 'deploy')),
  units numeric not null check (units >= 0),
  estimated_cost_usd numeric not null default 0 check (estimated_cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index usage_owner_idx on public.usage (owner_id, created_at desc);

-- Keep updated_at honest. Runs as the caller (security invoker), so it grants nothing extra.
create function public.touch_updated_at() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger project_files_touch before update on public.project_files for each row execute function public.touch_updated_at();
create trigger project_state_touch before update on public.project_state for each row execute function public.touch_updated_at();

alter table public.projects enable row level security;
alter table public.project_files enable row level security;
alter table public.project_state enable row level security;
alter table public.audit_log enable row level security;
alter table public.usage enable row level security;

-- Signed-in users only. The anon role gets nothing.
revoke all on public.projects, public.project_files, public.project_state, public.audit_log, public.usage from anon;
grant select, insert, update, delete on public.projects, public.project_files, public.project_state to authenticated;
grant select on public.audit_log, public.usage to authenticated;

create policy projects_select on public.projects for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy projects_insert on public.projects for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy projects_update on public.projects for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy projects_delete on public.projects for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Files and state belong to whoever owns the project. Knowing a project id is never enough.
create policy project_files_select on public.project_files for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy project_files_insert on public.project_files for insert to authenticated
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy project_files_update on public.project_files for update to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy project_files_delete on public.project_files for delete to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

create policy project_state_select on public.project_state for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy project_state_insert on public.project_state for insert to authenticated
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy project_state_update on public.project_state for update to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy project_state_delete on public.project_state for delete to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

-- Read-only for the owner. Inserts happen server-side with the service role, which bypasses RLS.
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy usage_select on public.usage for select to authenticated
  using ((select auth.uid()) = owner_id);
