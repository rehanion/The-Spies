-- Likes and creator points.
--
-- A signed in, active user can like an approved listing once (not their own).
-- templates.like_count counts the likes of active (not suspended) users.
-- profiles.points is one point per counted like on the creator's listings that
-- are approved or waiting for review. A listing a moderator rejected or
-- removed stops giving points until it is approved again, and a deleted
-- listing takes its points with it.
--
-- Both counters are recomputed from the likes table (not incremented), after
-- locking the row they live on, so concurrent likes, suspensions and deletes
-- cannot drift them. Clients cannot write either column.
--
-- Hosted Supabase grants EXECUTE on new public functions to anon and
-- authenticated, so every function below is revoked from them explicitly.

alter table public.templates
  add column like_count integer not null default 0 check (like_count >= 0);
alter table public.profiles
  add column points integer not null default 0 check (points >= 0);
-- Public counters. templates already has a table wide SELECT grant; profiles
-- uses column grants. No INSERT or UPDATE grant covers either column.
grant select (points) on public.profiles to anon, authenticated;

create index if not exists templates_public_likes_idx on public.templates (like_count desc)
  where publication_status = 'approved';

-- ---------------------------------------------------------------------------
-- Likes table: private to their owner (the counts are public columns).
-- ---------------------------------------------------------------------------
create table public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  template_id uuid not null references public.templates (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, template_id)
);
create index likes_template_idx on public.likes (template_id);
create index likes_user_recent_idx on public.likes (user_id, created_at desc);
alter table public.likes enable row level security;

revoke all on public.likes from public, anon, authenticated;
grant select, delete on public.likes to authenticated;
grant insert (user_id, template_id) on public.likes to authenticated;

create policy likes_read_own on public.likes for select to authenticated
  using (user_id = (select auth.uid()));
create policy likes_insert_own on public.likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
    and exists (
      select 1 from public.templates t
       where t.id = template_id and t.publication_status = 'approved' and t.creator_id <> (select auth.uid()))
  );
create policy likes_delete_own on public.likes for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Counters
-- ---------------------------------------------------------------------------
-- Likes on one listing from accounts that are not suspended.
create or replace function public.refresh_like_count(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  -- Lock first: the count below then runs with a snapshot taken after any
  -- concurrent writer of this row has committed.
  perform 1 from public.templates where id = p_template_id for update;
  if not found then
    return;
  end if;
  select count(*)::int into n
    from public.likes l
    join public.profiles p on p.id = l.user_id
   where l.template_id = p_template_id and not p.is_banned;
  update public.templates set like_count = n where id = p_template_id and like_count is distinct from n;
end;
$$;
revoke all on function public.refresh_like_count(uuid) from public, anon, authenticated;

-- One point per counted like on the creator's approved or pending listings.
create or replace function public.refresh_points(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    return;
  end if;
  update public.profiles p
     set points = s.total
    from (
      select coalesce(sum(t.like_count), 0)::int as total
        from public.templates t
       where t.creator_id = p_user_id and t.publication_status in ('approved', 'pending')
    ) s
   where p.id = p_user_id and p.points is distinct from s.total;
end;
$$;
revoke all on function public.refresh_points(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- No self likes and at most 200 likes per account per day (also for direct
-- API calls). The server action has its own hourly limit on top.
create or replace function public.likes_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.templates t where t.id = new.template_id and t.creator_id = new.user_id) then
    raise exception 'You cannot like your own template' using errcode = '42501';
  end if;
  -- One liker at a time, so parallel inserts cannot pass the check together.
  perform pg_advisory_xact_lock(hashtextextended('likes_insert:' || new.user_id::text, 0));
  if (select count(*) from public.likes l
      where l.user_id = new.user_id and l.created_at > now() - interval '24 hours') >= 200 then
    raise exception 'Like limit reached, try again tomorrow' using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end;
$$;
create trigger likes_guard before insert on public.likes
  for each row execute function public.likes_guard_insert();

create or replace function public.likes_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- When the listing itself is being deleted the row is already gone and the
  -- templates delete trigger below takes care of the creator's points.
  perform public.refresh_like_count(coalesce(new.template_id, old.template_id));
  return null;
end;
$$;
create trigger likes_counter after insert or delete on public.likes
  for each row execute function public.likes_after_change();

-- A listing's like count or status changed: refresh its creator's points.
create or replace function public.templates_after_like_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_points(old.creator_id);
    return null;
  end if;
  perform public.refresh_points(new.creator_id);
  if new.creator_id is distinct from old.creator_id then
    perform public.refresh_points(old.creator_id);
  end if;
  return null;
end;
$$;
create trigger templates_like_points after update on public.templates
  for each row when (
    new.like_count is distinct from old.like_count
    or new.publication_status is distinct from old.publication_status
    or new.creator_id is distinct from old.creator_id)
  execute function public.templates_after_like_points();
create trigger templates_like_points_delete after delete on public.templates
  for each row execute function public.templates_after_like_points();

-- Suspending or restoring an account recalculates the like counts it touched
-- (and through them the creators' points).
create or replace function public.profiles_after_ban_change_likes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tid uuid;
begin
  for tid in select l.template_id from public.likes l where l.user_id = new.id order by l.template_id loop
    perform public.refresh_like_count(tid);
  end loop;
  return null;
end;
$$;
create trigger profiles_ban_change_likes after update of is_banned on public.profiles
  for each row when (new.is_banned is distinct from old.is_banned)
  execute function public.profiles_after_ban_change_likes();

-- Clients never have a grant that writes these counters. These guards keep
-- them unchanged for any direct client statement too, in case a broader grant
-- is ever added by mistake. SECURITY INVOKER on purpose: current_user is the
-- client role for a direct statement and the function owner inside the
-- SECURITY DEFINER counter functions above.
create or replace function public.templates_guard_like_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.like_count := old.like_count;
  end if;
  return new;
end;
$$;
create trigger templates_guard_like_count before update on public.templates
  for each row when (new.like_count is distinct from old.like_count)
  execute function public.templates_guard_like_count();

create or replace function public.profiles_guard_points()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.points := old.points;
  end if;
  return new;
end;
$$;
create trigger profiles_guard_points before update on public.profiles
  for each row when (new.points is distinct from old.points)
  execute function public.profiles_guard_points();

revoke all on function public.likes_guard_insert() from public, anon, authenticated;
revoke all on function public.likes_after_change() from public, anon, authenticated;
revoke all on function public.templates_after_like_points() from public, anon, authenticated;
revoke all on function public.profiles_after_ban_change_likes() from public, anon, authenticated;
revoke all on function public.templates_guard_like_count() from public, anon, authenticated;
revoke all on function public.profiles_guard_points() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- search_templates: adds like_count to the results and a "likes" sort.
-- Same arguments as before; the result type changes, so drop and recreate.
-- ---------------------------------------------------------------------------
drop function public.search_templates(text, text, text, text, int, int, uuid, boolean);
create function public.search_templates(
  p_query text default null,
  p_platform text default null,
  p_category text default null,
  p_sort text default 'recent',
  p_limit int default 24,
  p_offset int default 0,
  p_creator uuid default null,
  p_following boolean default false
) returns table (
  id uuid, slug text, title text, summary text, platform_id text, category_id text, tags text[],
  platform_version text, download_count int, favorite_count int, rating_avg numeric, rating_count int,
  view_count int, comment_count int, like_count int,
  approved_at timestamptz, is_demo boolean, creator_username text, creator_display_name text,
  creator_avatar_key text, cover_thumb_key text, cover_public_key text, total_count bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  q tsquery;
  qtext text;
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 60);
begin
  select string_agg(tok || ':*', ' & ')
    into qtext
    from (select tok from regexp_split_to_table(lower(coalesce(p_query, '')), '[^a-z0-9]+') tok
          where tok <> '' limit 8) toks;
  if qtext is not null then
    q := to_tsquery('simple', qtext);
  end if;

  return query
  with base as materialized (
    select t.id, t.view_count, t.download_count, t.favorite_count, t.like_count, t.rating_avg, t.rating_count,
           t.approved_at, t.created_at, t.search_vector
      from public.templates t
     where t.publication_status = 'approved'
       and (p_platform is null or t.platform_id = p_platform)
       and (p_category is null or t.category_id = p_category)
       and (p_creator is null or t.creator_id = p_creator)
       and (not coalesce(p_following, false) or t.creator_id in (
             select f.creator_id from public.follows f where f.follower_id = auth.uid()))
       and (q is null or t.search_vector @@ q)
  ),
  total as (
    select count(*) as n from base
  ),
  ranked as (
    select b.id,
           row_number() over (order by
             case when p_sort = 'trending' then
               (b.view_count + 5 * b.download_count + 10 * b.favorite_count + 1)::float8
               / power(extract(epoch from (now() - coalesce(b.approved_at, b.created_at)))::float8 / 3600 + 2, 1.3)
             end desc nulls last,
             case when p_sort = 'likes' then b.like_count end desc nulls last,
             case when p_sort = 'downloads' then b.download_count end desc nulls last,
             case when p_sort = 'views' then b.view_count end desc nulls last,
             case when p_sort = 'rating' then b.rating_avg end desc nulls last,
             case when p_sort = 'rating' then b.rating_count end desc nulls last,
             case when p_sort = 'relevance' and q is not null then ts_rank(b.search_vector, q) end desc nulls last,
             b.approved_at desc nulls last,
             b.id) as rn
      from base b
  )
  select t.id, t.slug, t.title, t.summary, t.platform_id, t.category_id, t.tags, t.platform_version,
         t.download_count, t.favorite_count, t.rating_avg, t.rating_count, t.view_count, t.comment_count, t.like_count,
         t.approved_at, t.is_demo, p.username, p.display_name, p.avatar_key, s.thumb_key, s.public_key,
         (select n from total) as total_count
    from ranked r
    join public.templates t on t.id = r.id
    join public.profiles p on p.id = t.creator_id
    left join public.template_screenshots s on s.id = t.cover_screenshot_id and s.status = 'ready'
   where r.rn > v_offset and r.rn <= v_offset + v_limit
   order by r.rn;
end;
$$;
revoke all on function public.search_templates(text, text, text, text, int, int, uuid, boolean) from public;
grant execute on function public.search_templates(text, text, text, text, int, int, uuid, boolean) to anon, authenticated;

-- Verification: clients hold exactly the intended privileges on likes, and no
-- write privilege on the new counters.
do $$
declare
  unexpected text;
begin
  select string_agg(format('%s %s %s.%s', grantee, privilege_type, table_name, column_name), ', ')
    into unexpected
    from information_schema.column_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and (
       (table_name = 'likes' and not (
          grantee = 'authenticated' and (
            privilege_type = 'SELECT'
            or (privilege_type = 'INSERT' and column_name in ('user_id', 'template_id')))))
       or (table_name = 'templates' and column_name = 'like_count' and privilege_type <> 'SELECT')
       or (table_name = 'profiles' and column_name = 'points' and privilege_type <> 'SELECT')
     );
  if unexpected is not null then
    raise exception 'Unexpected client privileges: %', unexpected;
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('refresh_like_count', 'refresh_points', 'likes_guard_insert', 'likes_after_change',
                         'templates_after_like_points', 'profiles_after_ban_change_likes',
                         'templates_guard_like_count', 'profiles_guard_points')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  ) then
    raise exception 'Internal like functions must not be executable by clients';
  end if;
end
$$;
