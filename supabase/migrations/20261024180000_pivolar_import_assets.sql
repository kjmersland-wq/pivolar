-- Pivolar import: jobs that read a website into Pivolar, and the pictures and files they bring.
-- Pictures are checked, shrunk and stripped of metadata by the server before they are stored, and
-- are kept under the user's own folder, so nobody can write to or delete another user's files.

-- The jobs. The content model of the site is kept here until the import becomes a project.
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- Set when the import has become a project.
  project_id uuid references public.projects (id) on delete set null,
  source_url text not null check (char_length(source_url) <= 300),
  status text not null default 'fetched' check (status in ('fetched', 'images_done', 'stopped', 'failed')),
  model jsonb not null,
  media_total integer not null default 0 check (media_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_jobs_owner_idx on public.import_jobs (owner_id, created_at desc);
create trigger import_jobs_touch before update on public.import_jobs for each row execute function public.touch_updated_at();

-- One row per picture that was fetched, or tried and failed.
create table public.import_assets (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.import_jobs (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  source_url text not null check (char_length(source_url) <= 1000),
  -- Content hash of the stored file; the same picture used twice is stored once.
  hash text check (hash ~ '^[0-9a-f]{64}$'),
  -- The file name in the project and in storage: the start of the hash plus the extension.
  file text check (file ~ '^[0-9a-f]{12}\.(webp|png|jpg|gif|avif)$'),
  mime text check (mime in ('image/webp', 'image/png', 'image/jpeg', 'image/gif', 'image/avif')),
  bytes integer check (bytes between 1 and 10485760),
  source_bytes integer check (source_bytes >= 0),
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  -- Why a picture was not stored. Null for a picture that was.
  failed text check (failed in ('blocked', 'too-large', 'not-image', 'network', 'quota', 'limit', 'robots')),
  created_at timestamptz not null default now(),
  unique (job_id, source_url),
  check ((failed is null and hash is not null and file is not null and mime is not null and bytes is not null) or (failed is not null))
);
create index import_assets_owner_idx on public.import_assets (owner_id);

alter table public.import_jobs enable row level security;
alter table public.import_assets enable row level security;
revoke all on public.import_jobs, public.import_assets from anon;
grant select, insert, update, delete on public.import_jobs, public.import_assets to authenticated;

create policy import_jobs_select on public.import_jobs for select to authenticated using ((select auth.uid()) = owner_id);
create policy import_jobs_insert on public.import_jobs for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy import_jobs_update on public.import_jobs for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy import_jobs_delete on public.import_jobs for delete to authenticated using ((select auth.uid()) = owner_id);

-- A picture row can only be added to the user's own job.
create policy import_assets_select on public.import_assets for select to authenticated using ((select auth.uid()) = owner_id);
create policy import_assets_insert on public.import_assets for insert to authenticated
  with check ((select auth.uid()) = owner_id and exists (select 1 from public.import_jobs j where j.id = job_id and j.owner_id = (select auth.uid())));
create policy import_assets_delete on public.import_assets for delete to authenticated using ((select auth.uid()) = owner_id);

-- How much space the user's imported pictures use, for the storage limit. Counts each stored file once.
create function public.import_bytes_used() returns bigint
language sql security invoker set search_path = ''
as $$
  select coalesce(sum(b), 0)::bigint from (
    select distinct on (job_id, hash) bytes as b from public.import_assets
    where owner_id = (select auth.uid()) and failed is null
    order by job_id, hash
  ) s;
$$;
revoke all on function public.import_bytes_used() from public;
grant execute on function public.import_bytes_used() to authenticated;

-- The bucket. Public for reading, so a page can show a picture with a plain <img>, and so the
-- published site can copy it. Writing is limited to the user's own folder (the first part of the
-- path is the user's id), and only to picture types, so the bucket cannot be used for anything else.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pivolar-assets', 'pivolar-assets', true, 10485760, array['image/webp', 'image/png', 'image/jpeg', 'image/gif', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy pivolar_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pivolar-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pivolar_assets_select on storage.objects for select to authenticated
  using (bucket_id = 'pivolar-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pivolar_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pivolar-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
