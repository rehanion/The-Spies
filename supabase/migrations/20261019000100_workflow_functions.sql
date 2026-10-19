-- Workflow functions: download gate, submission, moderation, scan recording,
-- rate limiting, search and admin user management.

-- ---------------------------------------------------------------------------
-- Download gate. Single source of truth for "may this exact file be served?".
-- Returns 'ok' or a machine-readable reason.
-- ---------------------------------------------------------------------------
create or replace function public.file_download_state(p_file_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.template_files%rowtype;
  t public.templates%rowtype;
  creator_banned boolean;
begin
  select * into f from public.template_files where id = p_file_id;
  if not found then return 'not_found'; end if;
  select * into t from public.templates where id = f.template_id;
  if not found then return 'not_found'; end if;
  if t.publication_status <> 'approved' then return 'template_not_approved'; end if;
  select p.is_banned into creator_banned from public.profiles p where p.id = t.creator_id;
  if coalesce(creator_banned, true) then return 'creator_unavailable'; end if;
  if not f.is_current then return 'file_superseded'; end if;
  if f.validation_status <> 'passed' or f.sha256 is null then return 'validation_not_passed'; end if;
  if f.scan_status = 'pending' then return 'scan_pending'; end if;
  if f.scan_status = 'flagged' then return 'scan_flagged'; end if;
  if f.scan_status = 'error' then return 'scan_error'; end if;
  if f.scan_status <> 'clean' then return 'scan_unavailable'; end if;
  if f.scanned_sha256 is null or f.scanned_sha256 <> f.sha256 then return 'hash_mismatch'; end if;
  if f.approved_sha256 is null or f.approved_sha256 <> f.sha256 then return 'not_approved_version'; end if;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Creator: submit a draft (or resubmit a rejected listing) for moderation.
-- ---------------------------------------------------------------------------
create or replace function public.submit_template(p_template_id uuid)
returns public.publication_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.templates%rowtype;
  ready_shots int;
  good_files int;
  bad_files int;
begin
  select * into t from public.templates where id = p_template_id for update;
  if not found or t.creator_id is distinct from auth.uid() then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if not public.is_active_user() then
    raise exception 'Account is suspended' using errcode = '42501';
  end if;
  if t.publication_status not in ('draft', 'rejected', 'pending') then
    raise exception 'This listing cannot be submitted in its current state (%)', t.publication_status using errcode = 'P0001';
  end if;
  if not t.rights_attested then
    raise exception 'You must confirm you have the right to share these files' using errcode = 'P0001';
  end if;
  select count(*) into ready_shots from public.template_screenshots s where s.template_id = t.id and s.status = 'ready';
  if ready_shots < 1 then
    raise exception 'At least one processed screenshot is required' using errcode = 'P0001';
  end if;
  select count(*) filter (where validation_status = 'passed'),
         count(*) filter (where validation_status <> 'passed')
    into good_files, bad_files
    from public.template_files f where f.template_id = t.id and f.is_current;
  if good_files < 1 then
    raise exception 'At least one validated template file is required' using errcode = 'P0001';
  end if;
  if bad_files > 0 then
    raise exception 'Remove or replace files that are still processing or failed validation' using errcode = 'P0001';
  end if;
  if t.cover_screenshot_id is null or not exists (
    select 1 from public.template_screenshots s where s.id = t.cover_screenshot_id and s.status = 'ready'
  ) then
    update public.templates set cover_screenshot_id = (
      select s.id from public.template_screenshots s
      where s.template_id = t.id and s.status = 'ready' order by s.position, s.created_at limit 1
    ) where id = t.id;
  end if;
  update public.templates
     set publication_status = 'pending', submitted_at = now(), moderation_note = null
   where id = t.id;
  return 'pending';
end;
$$;

-- Creator: withdraw their own listing from public view.
create or replace function public.withdraw_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.templates
     set publication_status = 'removed', moderation_note = 'Withdrawn by creator', approved_at = null, approved_by = null
   where id = p_template_id and creator_id = auth.uid() and publication_status <> 'removed';
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Creator: reorder screenshots atomically.
create or replace function public.reorder_screenshots(p_template_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i int;
begin
  if not exists (select 1 from public.templates t where t.id = p_template_id and t.creator_id = auth.uid()
                 and t.publication_status <> 'removed') then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.template_screenshots s where s.template_id = p_template_id)
     <> cardinality(p_ids)
     or exists (select 1 from unnest(p_ids) x(id)
                where not exists (select 1 from public.template_screenshots s where s.id = x.id and s.template_id = p_template_id)) then
    raise exception 'Screenshot list does not match this template' using errcode = 'P0001';
  end if;
  for i in 1 .. cardinality(p_ids) loop
    update public.template_screenshots set position = i - 1 where id = p_ids[i];
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: moderation decisions.
-- ---------------------------------------------------------------------------
create or replace function public.moderate_template(p_template_id uuid, p_action text, p_reason text default null)
returns public.publication_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.templates%rowtype;
  blocking int;
  new_status public.publication_status;
begin
  if not public.is_staff() then
    raise exception 'Staff permission required' using errcode = '42501';
  end if;
  select * into t from public.templates where id = p_template_id for update;
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;

  if p_action = 'approve' then
    if t.publication_status not in ('pending', 'rejected', 'removed') then
      raise exception 'Only pending, rejected or removed listings can be approved' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.template_files f where f.template_id = t.id and f.is_current) then
      raise exception 'Listing has no files' using errcode = 'P0001';
    end if;
    select count(*) into blocking from public.template_files f
     where f.template_id = t.id and f.is_current and (
       f.validation_status <> 'passed' or f.sha256 is null or f.scan_status <> 'clean'
       or f.scanned_sha256 is null or f.scanned_sha256 <> f.sha256);
    if blocking > 0 then
      raise exception 'Every current file needs passed validation and a clean scan whose hash matches the stored object' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.template_screenshots s where s.template_id = t.id and s.status = 'ready') then
      raise exception 'Listing has no processed screenshot' using errcode = 'P0001';
    end if;
    update public.template_files set approved_sha256 = sha256 where template_id = t.id and is_current;
    update public.templates
       set publication_status = 'approved', approved_at = now(), approved_by = auth.uid(),
           moderation_note = nullif(trim(coalesce(p_reason, '')), '')
     where id = t.id;
    new_status := 'approved';
  elsif p_action = 'reject' then
    if coalesce(char_length(trim(p_reason)), 0) < 5 then
      raise exception 'A rejection reason is required' using errcode = 'P0001';
    end if;
    update public.template_files set approved_sha256 = null where template_id = t.id;
    update public.templates
       set publication_status = 'rejected', approved_at = null, approved_by = null, moderation_note = trim(p_reason)
     where id = t.id;
    new_status := 'rejected';
  elsif p_action = 'remove' then
    if coalesce(char_length(trim(p_reason)), 0) < 5 then
      raise exception 'A removal reason is required' using errcode = 'P0001';
    end if;
    update public.template_files set approved_sha256 = null where template_id = t.id;
    update public.templates
       set publication_status = 'removed', approved_at = null, approved_by = null, moderation_note = trim(p_reason)
     where id = t.id;
    new_status := 'removed';
  else
    raise exception 'Unknown moderation action' using errcode = 'P0001';
  end if;

  perform public.log_event('moderation:' || p_action, t.id, null, jsonb_build_object('reason', p_reason));
  return new_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: record a scan result for the exact stored object.
-- A hash mismatch records an error result and invalidates approval.
-- ---------------------------------------------------------------------------
create or replace function public.record_scan_result(
  p_file_id uuid,
  p_result public.scan_status,
  p_scanner_name text,
  p_scanner_version text,
  p_signature_version text,
  p_scanned_sha256 text,
  p_scanned_at timestamptz default now(),
  p_notes text default '',
  p_raw_output text default ''
) returns public.scan_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.template_files%rowtype;
  normalized text := lower(trim(coalesce(p_scanned_sha256, '')));
  matched boolean;
  effective public.scan_status;
begin
  if not public.is_staff() then
    raise exception 'Staff permission required' using errcode = '42501';
  end if;
  if p_result not in ('clean', 'flagged', 'error') then
    raise exception 'Scan result must be clean, flagged or error' using errcode = 'P0001';
  end if;
  if normalized !~ '^[0-9a-f]{64}$' then
    raise exception 'Scanned SHA-256 must be 64 hex characters' using errcode = 'P0001';
  end if;
  if p_scanned_at > now() + interval '5 minutes' then
    raise exception 'Scan time cannot be in the future' using errcode = 'P0001';
  end if;
  select * into f from public.template_files where id = p_file_id for update;
  if not found then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  if not f.is_current then
    raise exception 'This file version has been superseded' using errcode = 'P0001';
  end if;
  if f.sha256 is null or f.validation_status <> 'passed' then
    raise exception 'File has not passed structural validation yet' using errcode = 'P0001';
  end if;

  matched := normalized = f.sha256;
  effective := case when matched then p_result else 'error'::public.scan_status end;

  insert into public.scan_records (file_id, result, scanner_name, scanner_version, signature_version,
    scanned_sha256, expected_sha256, hash_match, notes, raw_output, recorded_by, scanned_at)
  values (f.id, effective, trim(p_scanner_name), trim(p_scanner_version), trim(p_signature_version),
    normalized, f.sha256, matched,
    left(coalesce(p_notes, '') || case when matched then '' else ' [hash mismatch: scanned file differs from stored object]' end, 2000),
    left(coalesce(p_raw_output, ''), 8000), auth.uid(), p_scanned_at);

  update public.template_files set
    scan_status = effective,
    scanned_at = p_scanned_at,
    scanner_name = trim(p_scanner_name),
    scanner_version = trim(p_scanner_version),
    signature_version = trim(p_signature_version),
    scanned_sha256 = normalized,
    approved_sha256 = case when effective = 'clean' then approved_sha256 else null end
  where id = f.id;

  -- Anything but a matching clean scan pulls an approved listing back into review.
  if effective <> 'clean' then
    update public.templates
       set publication_status = 'pending', approved_at = null, approved_by = null,
           moderation_note = case when matched then 'Scan result: ' || effective::text else 'Scan hash mismatch' end
     where id = f.template_id and publication_status = 'approved';
  end if;

  perform public.log_event(
    case when matched then 'scan:' || effective::text else 'scan:hash_mismatch' end,
    f.template_id, f.id,
    jsonb_build_object('scanner', p_scanner_name, 'scanner_version', p_scanner_version,
                       'signature_version', p_signature_version, 'scanned_sha256', normalized,
                       'expected_sha256', f.sha256));
  return effective;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: reports and users.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_report(p_report_id uuid, p_status public.report_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports%rowtype;
begin
  if not public.is_staff() then
    raise exception 'Staff permission required' using errcode = '42501';
  end if;
  if p_status = 'open' then
    raise exception 'Use resolved or dismissed' using errcode = 'P0001';
  end if;
  update public.reports set status = p_status, resolution_note = p_note, resolved_by = auth.uid(), resolved_at = now()
   where id = p_report_id returning * into r;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  perform public.log_event('report:' || p_status::text, r.template_id, null,
    jsonb_build_object('report_id', r.id, 'kind', r.kind, 'note', p_note));
end;
$$;

create or replace function public.admin_set_user_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Admins cannot change their own role' using errcode = 'P0001';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  perform public.log_event('user:role', null, null, jsonb_build_object('role', p_role), p_user_id);
end;
$$;

create or replace function public.admin_set_banned(p_user_id uuid, p_banned boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff permission required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot suspend yourself' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and role = 'admin') and not public.is_admin() then
    raise exception 'Only admins can suspend admins' using errcode = '42501';
  end if;
  update public.profiles set is_banned = p_banned where id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  perform public.log_event(case when p_banned then 'user:suspend' else 'user:unsuspend' end,
    null, null, jsonb_build_object('reason', p_reason), p_user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-only helpers (called by the Next.js server with the secret key).
-- ---------------------------------------------------------------------------

-- Fixed-window rate limiter. Returns true when the hit is allowed.
create or replace function public.consume_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
begin
  insert into public.rate_limits as rl (bucket_key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update set
    window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end,
    hits = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rl.hits + 1 end
  returning hits <= p_limit into allowed;
  -- Opportunistic cleanup of stale buckets.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return allowed;
end;
$$;

-- Records a download and counts it at most once per actor per file per 24h.
create or replace function public.register_download(p_file_id uuid, p_actor_hash text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.template_files%rowtype;
  already boolean;
begin
  if public.file_download_state(p_file_id) <> 'ok' then
    raise exception 'File is not downloadable' using errcode = '42501';
  end if;
  select * into f from public.template_files where id = p_file_id;
  select exists (
    select 1 from public.download_events d
    where d.file_id = p_file_id and d.actor_hash = p_actor_hash and d.counted
      and d.created_at > now() - interval '24 hours'
  ) into already;
  insert into public.download_events (file_id, template_id, user_id, actor_hash, counted)
  values (p_file_id, f.template_id, p_user_id, p_actor_hash, not already);
  if not already then
    update public.templates set download_count = download_count + 1 where id = f.template_id;
  end if;
  return not already;
end;
$$;

-- Storage usage summary (bytes of objects that still exist), used for quota
-- enforcement and the admin dashboard. Rejected/superseded originals and
-- processed screenshot originals are deleted, so they are not counted.
create or replace function public.file_bytes_expr(f public.template_files)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when f.validation_status = 'failed' or not f.is_current then 0
              else coalesce(f.size_bytes, f.declared_size_bytes) end;
$$;

create or replace function public.shot_bytes_expr(s public.template_screenshots)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select (case when s.status = 'pending' then s.declared_size_bytes else 0 end) + coalesce(s.public_size_bytes, 0);
$$;

create or replace function public.storage_usage()
returns table (
  file_bytes bigint, screenshot_bytes bigint, total_bytes bigint,
  pending_scan_count bigint, pending_review_count bigint, open_report_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with f as (select coalesce(sum(public.file_bytes_expr(x)), 0)::bigint b from public.template_files x),
       s as (select coalesce(sum(public.shot_bytes_expr(y)), 0)::bigint b from public.template_screenshots y)
  select f.b, s.b, f.b + s.b,
    (select count(*) from public.template_files where is_current and scan_status = 'pending' and validation_status = 'passed'),
    (select count(*) from public.templates where publication_status = 'pending'),
    (select count(*) from public.reports where status = 'open')
  from f, s;
$$;

create or replace function public.user_storage_usage(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (
    coalesce((select sum(public.file_bytes_expr(x)) from public.template_files x where x.uploader_id = p_user_id), 0)
    + coalesce((select sum(public.shot_bytes_expr(y)) from public.template_screenshots y where y.uploader_id = p_user_id), 0)
  )::bigint;
$$;

-- ---------------------------------------------------------------------------
-- Public search (SECURITY INVOKER: RLS applies; only approved rows returned).
-- ---------------------------------------------------------------------------
create or replace function public.search_templates(
  p_query text default null,
  p_platform text default null,
  p_category text default null,
  p_sort text default 'recent',
  p_limit int default 24,
  p_offset int default 0,
  p_creator uuid default null
) returns table (
  id uuid, slug text, title text, summary text, platform_id text, category_id text, tags text[],
  platform_version text, download_count int, favorite_count int, rating_avg numeric, rating_count int,
  approved_at timestamptz, is_demo boolean, creator_username text, creator_display_name text,
  cover_thumb_key text, cover_public_key text, total_count bigint
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
       and (q is null or t.search_vector @@ q)
  )
  select b.id, b.slug, b.title, b.summary, b.platform_id, b.category_id, b.tags, b.platform_version,
         b.download_count, b.favorite_count, b.rating_avg, b.rating_count, b.approved_at, b.is_demo,
         p.username, p.display_name, s.thumb_key, s.public_key,
         count(*) over () as total_count
    from base b
    join public.profiles p on p.id = b.creator_id
    left join public.template_screenshots s on s.id = b.cover_screenshot_id and s.status = 'ready'
   order by
     case when p_sort = 'downloads' then b.download_count end desc nulls last,
     case when p_sort = 'rating' then b.rating_avg end desc nulls last,
     case when p_sort = 'rating' then b.rating_count end desc nulls last,
     case when p_sort = 'relevance' and q is not null then ts_rank(b.search_vector, q) end desc nulls last,
     b.approved_at desc nulls last,
     b.id
   limit least(greatest(coalesce(p_limit, 24), 1), 60)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
