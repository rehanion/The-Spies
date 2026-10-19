-- Hosted Supabase grants EXECUTE on new functions to anon and authenticated.
-- Trigger functions are internal (they cannot run outside a trigger anyway),
-- and admin-only functions need no anonymous access, so take those grants away.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end
$$;

revoke execute on function public.admin_set_auto_publish(boolean) from public, anon;
