-- Pivolar: a record of the owner's confirmation when a website is imported.
-- audit_log can be read by its owner but not written from the browser or the signed-in session.
-- This function is the one way in: it writes for the caller only, only for the actions listed, and keeps the detail small.
-- Run this in the Supabase SQL Editor.

create function public.log_audit(p_action text, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_action not in ('import_owner_confirmed') then raise exception 'unknown action'; end if;
  if p_detail is not null and char_length(p_detail::text) > 2000 then raise exception 'detail too large'; end if;
  insert into public.audit_log (owner_id, action, detail) values (uid, p_action, p_detail);
end;
$$;

revoke all on function public.log_audit(text, jsonb) from public, anon;
grant execute on function public.log_audit(text, jsonb) to authenticated;
