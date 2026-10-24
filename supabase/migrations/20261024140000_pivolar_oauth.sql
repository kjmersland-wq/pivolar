-- Pivolar OAuth: the sign-ins that let a published site use the owner's Gmail, Sheets, Drive or Calendar.
-- The refresh token is encrypted by the app (AES-GCM) before it is stored, so a database export
-- alone does not give access. Only the owner of the project can read or change a row.

create table public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  provider text not null check (provider in ('google')),
  service text not null check (service in ('gmail', 'sheets', 'drive', 'calendar')),
  email text check (char_length(email) <= 200),
  refresh_token text not null check (char_length(refresh_token) between 20 and 4000),
  created_at timestamptz not null default now(),
  unique (project_id, provider, service)
);
create index oauth_connections_owner_idx on public.oauth_connections (owner_id, project_id);

alter table public.oauth_connections enable row level security;
revoke all on public.oauth_connections from anon;
grant select, insert, update, delete on public.oauth_connections to authenticated;

create policy oauth_connections_select on public.oauth_connections for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy oauth_connections_insert on public.oauth_connections for insert to authenticated
  with check ((select auth.uid()) = owner_id and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy oauth_connections_update on public.oauth_connections for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy oauth_connections_delete on public.oauth_connections for delete to authenticated
  using ((select auth.uid()) = owner_id);
