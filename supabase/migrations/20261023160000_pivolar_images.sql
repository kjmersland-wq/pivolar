-- Pivolar: storage for AI-generated images (emblems, hero pictures, illustrations).
-- The bucket is public for reading, so a page can show an image with a plain <img> address.
-- Writing is limited to signed-in users and only inside their own folder (the first path
-- segment must be their user id), so nobody can overwrite or fill someone else's space.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pivolar-images', 'pivolar-images', true, 8388608, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy pivolar_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pivolar-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy pivolar_images_select on storage.objects for select to authenticated
  using (bucket_id = 'pivolar-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy pivolar_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pivolar-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
