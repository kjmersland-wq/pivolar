-- Pivolar: files the owner adds to a project (pictures, sound and PDFs).
-- They go straight from the browser to this bucket through a signed address the server hands out after
-- checking the name, the type, the size and how much the user already has. Reading is public, so a page can
-- show a picture or play a sound with a plain address, and so a published site can copy the file.
-- Writing and deleting are limited to the user's own folder (the first part of the path is the user's id),
-- and only to the types below. No SVG, HTML or script is allowed.
-- Run this in the Supabase SQL Editor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pivolar-uploads', 'pivolar-uploads', true, 26214400,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy pivolar_uploads_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pivolar-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pivolar_uploads_select on storage.objects for select to authenticated
  using (bucket_id = 'pivolar-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pivolar_uploads_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pivolar-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- How much space the user's files use, for the storage limit. Only the user's own folder is counted.
create function public.upload_bytes_used() returns bigint
language sql security invoker set search_path = ''
as $$
  select coalesce(sum((metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects
  where bucket_id = 'pivolar-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text;
$$;
revoke all on function public.upload_bytes_used() from public, anon;
grant execute on function public.upload_bytes_used() to authenticated;
