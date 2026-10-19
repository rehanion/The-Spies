-- Community features (follows, comments, view counts) and automatic
-- publishing once every automated check has passed.

-- ---------------------------------------------------------------------------
-- Site settings (single row). auto_publish: a listing goes live as soon as
-- every current file passed validation and has a clean scan of the exact
-- stored bytes. Moderators can still reject or remove it afterwards.
-- ---------------------------------------------------------------------------
create table public.site_settings (
  id int primary key default 1 check (id = 1),
  auto_publish boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.site_settings (id) values (1);
alter table public.site_settings enable row level security;
grant select on public.site_settings to anon, authenticated;
create policy site_settings_read on public.site_settings for select to anon, authenticated using (true);

create or replace function public.admin_set_auto_publish(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  update public.site_settings set auto_publish = p_enabled, updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public.log_event('settings:auto_publish', null, null, jsonb_build_object('enabled', p_enabled));
  return p_enabled;
end;
$$;
grant execute on function public.admin_set_auto_publish(boolean) to authenticated;

-- Publishes a pending listing when auto_publish is on and the same conditions
-- a moderator's approval requires are met. Internal: no client grant.
create or replace function public.try_auto_publish(p_template_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.templates%rowtype;
begin
  if not coalesce((select auto_publish from public.site_settings where id = 1), false) then
    return false;
  end if;
  select * into t from public.templates where id = p_template_id;
  if not found or t.publication_status <> 'pending' or not t.rights_attested then
    return false;
  end if;
  if exists (select 1 from public.profiles p where p.id = t.creator_id and p.is_banned) then
    return false;
  end if;
  if not exists (select 1 from public.template_files f where f.template_id = t.id and f.is_current) then
    return false;
  end if;
  if exists (
    select 1 from public.template_files f
     where f.template_id = t.id and f.is_current and (
       f.validation_status <> 'passed' or f.sha256 is null or f.scan_status <> 'clean'
       or f.scanned_sha256 is null or f.scanned_sha256 <> f.sha256)
  ) then
    return false;
  end if;
  if not exists (select 1 from public.template_screenshots s where s.template_id = t.id and s.status = 'ready') then
    return false;
  end if;
  update public.template_files set approved_sha256 = sha256 where template_id = t.id and is_current;
  update public.templates
     set publication_status = 'approved', approved_at = now(), approved_by = null, moderation_note = null
   where id = t.id;
  perform public.log_event('auto_publish', t.id, null, '{}'::jsonb);
  return true;
end;
$$;
revoke all on function public.try_auto_publish(uuid) from public, anon, authenticated;

create or replace function public.templates_after_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.try_auto_publish(new.id);
  return null;
end;
$$;
-- Plain "after update" (not "update of publication_status"): the status is
-- often changed by the BEFORE trigger templates_guard, which "update of" ignores.
create trigger templates_auto_publish after update on public.templates
  for each row when (new.publication_status = 'pending' and old.publication_status is distinct from 'pending')
  execute function public.templates_after_pending();

create or replace function public.template_files_after_clean()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.try_auto_publish(new.template_id);
  return null;
end;
$$;
create trigger template_files_auto_publish after update of scan_status on public.template_files
  for each row when (new.scan_status = 'clean' and old.scan_status is distinct from 'clean')
  execute function public.template_files_after_clean();

-- ---------------------------------------------------------------------------
-- Counters
-- ---------------------------------------------------------------------------
alter table public.templates
  add column view_count integer not null default 0 check (view_count >= 0),
  add column comment_count integer not null default 0 check (comment_count >= 0);
alter table public.profiles
  add column follower_count integer not null default 0 check (follower_count >= 0);
grant select (follower_count) on public.profiles to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Follows ("subscribe to a creator")
-- ---------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, creator_id),
  check (follower_id <> creator_id)
);
create index follows_creator_idx on public.follows (creator_id);
alter table public.follows enable row level security;
grant select, insert, delete on public.follows to authenticated;
-- anon needs the table privilege because search_templates references follows in
-- its plan; with no anon policy, RLS returns zero rows to anonymous callers.
grant select on public.follows to anon;
create policy follows_read_own on public.follows for select to authenticated
  using (follower_id = (select auth.uid()));
create policy follows_insert_own on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid()) and (select public.is_active_user()));
create policy follows_delete_own on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()));

create or replace function public.follows_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.follows f
      where f.follower_id = new.follower_id and f.created_at > now() - interval '24 hours') >= 200 then
    raise exception 'Follow limit reached, try again tomorrow' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger follows_guard before insert on public.follows
  for each row execute function public.follows_guard_insert();

create or replace function public.follows_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set follower_count = follower_count + 1 where id = new.creator_id;
  else
    update public.profiles set follower_count = greatest(follower_count - 1, 0) where id = old.creator_id;
  end if;
  return null;
end;
$$;
create trigger follows_counter after insert or delete on public.follows
  for each row execute function public.follows_count();

-- ---------------------------------------------------------------------------
-- Comments (one level of replies)
-- ---------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_template_idx on public.comments (template_id, created_at);
create index comments_author_idx on public.comments (author_id, created_at desc);
alter table public.comments enable row level security;
grant select on public.comments to anon, authenticated;
grant insert (template_id, author_id, parent_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;
grant delete on public.comments to authenticated;

create policy comments_read on public.comments for select to anon, authenticated
  using (
    exists (select 1 from public.templates t where t.id = template_id)  -- template RLS decides visibility
    and exists (select 1 from public.profiles p where p.id = author_id and not p.is_banned)
  );
create policy comments_insert_own on public.comments for insert to authenticated
  with check (
    author_id = (select auth.uid()) and (select public.is_active_user())
    and exists (select 1 from public.templates t where t.id = template_id and t.publication_status = 'approved')
  );
create policy comments_update_own on public.comments for update to authenticated
  using (author_id = (select auth.uid()) and (select public.is_active_user()))
  with check (author_id = (select auth.uid()));
create policy comments_delete_own on public.comments for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_staff()));

create or replace function public.comments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.comments%rowtype;
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.comments c
        where c.author_id = new.author_id and c.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'You are commenting too quickly. Please wait a while.' using errcode = 'P0001';
    end if;
    if new.parent_id is not null then
      select * into parent from public.comments where id = new.parent_id;
      if not found or parent.template_id <> new.template_id then
        raise exception 'Reply target not found' using errcode = 'P0001';
      end if;
      -- Replies to replies attach to the top-level comment.
      if parent.parent_id is not null then
        new.parent_id := parent.parent_id;
      end if;
    end if;
    new.created_at := now();
    new.edited_at := null;
  else
    new.edited_at := now();
  end if;
  new.body := trim(new.body);
  return new;
end;
$$;
create trigger comments_guard before insert or update on public.comments
  for each row execute function public.comments_guard();

create or replace function public.comments_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.templates set comment_count = comment_count + 1 where id = new.template_id;
  else
    update public.templates set comment_count = greatest(comment_count - 1, 0) where id = old.template_id;
  end if;
  return null;
end;
$$;
create trigger comments_counter after insert or delete on public.comments
  for each row execute function public.comments_count();

alter table public.reports add column comment_id uuid references public.comments (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Views: counted once per actor per template per day (salted hash, no IPs).
-- ---------------------------------------------------------------------------
create table public.template_views (
  template_id uuid not null references public.templates (id) on delete cascade,
  actor_hash text not null check (char_length(actor_hash) between 16 and 128),
  view_date date not null default current_date,
  primary key (template_id, actor_hash, view_date)
);
alter table public.template_views enable row level security;
-- No client grants: written only by register_view (service role).

create or replace function public.register_view(p_template_id uuid, p_actor_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted int;
begin
  if not exists (select 1 from public.templates where id = p_template_id and publication_status = 'approved') then
    return false;
  end if;
  insert into public.template_views (template_id, actor_hash) values (p_template_id, p_actor_hash)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted > 0 then
    update public.templates set view_count = view_count + 1 where id = p_template_id;
    -- Keep the table small on the free database.
    delete from public.template_views where view_date < current_date - 2;
  end if;
  return inserted > 0;
end;
$$;
revoke all on function public.register_view(uuid, text) from public, anon, authenticated;
grant execute on function public.register_view(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Search: adds view/comment counts, a "trending" sort and a following feed.
-- ---------------------------------------------------------------------------
drop function public.search_templates(text, text, text, text, int, int, uuid);
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
  view_count int, comment_count int,
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
begin
  select string_agg(tok || ':*', ' & ')
    into qtext
    from (select tok from regexp_split_to_table(lower(coalesce(p_query, '')), '[^a-z0-9]+') tok
          where tok <> '' limit 8) toks;
  if qtext is not null then
    q := to_tsquery('simple', qtext);
  end if;

  return query
  with base as (
    select t.*
      from public.templates t
     where t.publication_status = 'approved'
       and (p_platform is null or t.platform_id = p_platform)
       and (p_category is null or t.category_id = p_category)
       and (p_creator is null or t.creator_id = p_creator)
       and (not coalesce(p_following, false) or t.creator_id in (
             select f.creator_id from public.follows f where f.follower_id = auth.uid()))
       and (q is null or t.search_vector @@ q)
  )
  select b.id, b.slug, b.title, b.summary, b.platform_id, b.category_id, b.tags, b.platform_version,
         b.download_count, b.favorite_count, b.rating_avg, b.rating_count, b.view_count, b.comment_count,
         b.approved_at, b.is_demo, p.username, p.display_name, p.avatar_key, s.thumb_key, s.public_key,
         count(*) over () as total_count
    from base b
    join public.profiles p on p.id = b.creator_id
    left join public.template_screenshots s on s.id = b.cover_screenshot_id and s.status = 'ready'
   order by
     case when p_sort = 'trending' then
       (b.view_count + 5 * b.download_count + 10 * b.favorite_count + 1)::numeric
       / power(extract(epoch from (now() - coalesce(b.approved_at, b.created_at))) / 3600 + 2, 1.3)
     end desc nulls last,
     case when p_sort = 'downloads' then b.download_count end desc nulls last,
     case when p_sort = 'views' then b.view_count end desc nulls last,
     case when p_sort = 'rating' then b.rating_avg end desc nulls last,
     case when p_sort = 'rating' then b.rating_count end desc nulls last,
     case when p_sort = 'relevance' and q is not null then ts_rank(b.search_vector, q) end desc nulls last,
     b.approved_at desc nulls last,
     b.id
   limit least(greatest(coalesce(p_limit, 24), 1), 60)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
grant execute on function public.search_templates(text, text, text, text, int, int, uuid, boolean) to anon, authenticated;
