-- Pivolar: the record of domain purchases. Buying a domain costs money, so every attempt is written down
-- before anything is bought, and Pivolar refuses to buy when it cannot write it.
-- This replaces the function from 20261024200000_pivolar_audit.sql with one that accepts two more actions.
-- Run this in the Supabase SQL Editor.

create or replace function public.log_audit(p_action text, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_action not in ('import_owner_confirmed', 'domain_purchase_attempt', 'domain_purchase') then raise exception 'unknown action'; end if;
  if p_detail is not null and char_length(p_detail::text) > 2000 then raise exception 'detail too large'; end if;
  insert into public.audit_log (owner_id, action, detail) values (uid, p_action, p_detail);
end;
$$;

revoke all on function public.log_audit(text, jsonb) from public, anon;
grant execute on function public.log_audit(text, jsonb) to authenticated;
