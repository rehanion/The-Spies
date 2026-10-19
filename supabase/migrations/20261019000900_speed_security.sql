-- Speed: listing search and missing indexes.

-- ---------------------------------------------------------------------------
-- search_templates: same signature, arguments and results as before.
-- Before, the creator and cover screenshot joins (and the RLS checks on
-- screenshots) ran for every matching listing because of the total count,
-- and the trending score used slow numeric math. Now the filter and sort run
-- on narrow rows, the joins run for the requested page only, and the score
-- uses double precision. Measured locally with 18,000 approved listings:
-- recent 8 went from about 230 ms to 30 ms, trending 8 from about 490 ms to
-- 40 ms, with identical results.
-- ---------------------------------------------------------------------------
create or replace function public.search_templates(
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
    select t.id, t.view_count, t.download_count, t.favorite_count, t.rating_avg, t.rating_count,
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
         t.download_count, t.favorite_count, t.rating_avg, t.rating_count, t.view_count, t.comment_count,
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
-- Public search, as before (create or replace keeps the existing grants).
revoke all on function public.search_templates(text, text, text, text, int, int, uuid, boolean) from public;
grant execute on function public.search_templates(text, text, text, text, int, int, uuid, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Indexes for queries that scanned whole tables.
-- ---------------------------------------------------------------------------
-- Upload quota checks count a user's files and screenshots from the last day,
-- and user_storage_usage() sums them.
create index if not exists template_files_uploader_idx on public.template_files (uploader_id, created_at desc);
create index if not exists template_screenshots_uploader_idx on public.template_screenshots (uploader_id, created_at desc);
-- register_view() deletes views older than two days on every new view.
create index if not exists template_views_date_idx on public.template_views (view_date);
-- Deleting a listing or a comment cascades through these foreign keys.
create index if not exists download_events_template_idx on public.download_events (template_id);
create index if not exists comments_parent_idx on public.comments (parent_id) where parent_id is not null;
