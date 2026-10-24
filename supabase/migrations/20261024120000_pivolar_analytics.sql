-- Pivolar analytics: page views on published sites, counted without cookies.
-- A site sends one small message per page view. The server never stores an IP address: a visitor
-- is a hash of address, browser and day, so the same person looks like a new visitor tomorrow.
-- The anon role can only call record_hit(), which checks everything. Only the project owner can read.

create table public.site_hits (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  path text not null check (char_length(path) between 1 and 200),
  source text not null check (source in ('direct', 'search', 'ai', 'social', 'referral', 'ads')),
  referrer_host text check (char_length(referrer_host) <= 120),
  country text check (country ~ '^[A-Z]{2}$'),
  device text not null check (device in ('desktop', 'mobile', 'tablet')),
  visitor text not null check (char_length(visitor) between 16 and 64)
);
create index site_hits_project_idx on public.site_hits (project_id, created_at desc);
create index site_hits_visitor_idx on public.site_hits (project_id, visitor, created_at desc);

alter table public.site_hits enable row level security;
revoke all on public.site_hits from anon;
grant select on public.site_hits to authenticated;

create policy site_hits_select on public.site_hits for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

-- The only way in for visitors. It runs with the table owner's rights, so it validates every value
-- itself, ignores projects that do not exist, and slows down anyone who sends too much.
create function public.record_hit(
  p_project uuid,
  p_path text,
  p_source text,
  p_referrer_host text,
  p_country text,
  p_device text,
  p_visitor text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_path is null or char_length(p_path) not between 1 and 200 then return; end if;
  if p_source is null or p_source not in ('direct', 'search', 'ai', 'social', 'referral', 'ads') then return; end if;
  if p_device is null or p_device not in ('desktop', 'mobile', 'tablet') then return; end if;
  if p_visitor is null or char_length(p_visitor) not between 16 and 64 then return; end if;
  if p_referrer_host is not null and char_length(p_referrer_host) > 120 then p_referrer_host := null; end if;
  if p_country is not null and p_country !~ '^[A-Z]{2}$' then p_country := null; end if;
  if not exists (select 1 from public.projects where id = p_project) then return; end if;

  -- At most 30 views per visitor and 600 per site in a minute.
  if (select count(*) from public.site_hits where project_id = p_project and visitor = p_visitor and created_at > now() - interval '1 minute') >= 30 then return; end if;
  if (select count(*) from public.site_hits where project_id = p_project and created_at > now() - interval '1 minute') >= 600 then return; end if;

  insert into public.site_hits (project_id, path, source, referrer_host, country, device, visitor)
  values (p_project, p_path, p_source, p_referrer_host, p_country, p_device, p_visitor);
end;
$$;

revoke all on function public.record_hit(uuid, text, text, text, text, text, text) from public;
grant execute on function public.record_hit(uuid, text, text, text, text, text, text) to anon, authenticated;
