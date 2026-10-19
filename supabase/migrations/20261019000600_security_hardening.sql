-- Security hardening:
--   1. Storage: small private upload buckets for screenshots and avatars,
--      recorded avatar reservations, quotas from the real stored object sizes,
--      and a sweep for stale reservations and orphaned objects.
--   2. A listing a moderator rejected or removed never auto-publishes again
--      until a moderator approves it (templates.requires_review).
--   4. A least-privilege scanner account (profiles.is_scanner) instead of a
--      moderator: it can only read and record scans of files waiting for one.
--   5. A per-user daily cap on new listings enforced in the database.
--   7. Suspended users cannot favorite and their reviews stop counting.
--   Explicit re-grants on comments and follows.
--
-- Hosted Supabase grants EXECUTE on new public functions to anon and
-- authenticated, so every function below is revoked from them explicitly and
-- granted only where a client really calls it.

-- ===========================================================================
-- 1. Storage
-- ===========================================================================

-- Screenshots and avatars no longer go to the 20 MB quarantine bucket. Each
-- gets a private bucket whose per-object limit matches its upload limit, so a
-- signed upload URL cannot be used to store more than that.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('screenshot-uploads', 'screenshot-uploads', false, 8388608, array['application/octet-stream']),
  ('avatar-uploads', 'avatar-uploads', false, 2097152, array['application/octet-stream'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Existing rows keep pointing at the quarantine bucket; new rows use the new one.
alter table public.template_screenshots
  add column original_bucket text not null default 'quarantine'
    check (original_bucket in ('quarantine', 'screenshot-uploads'));
alter table public.template_screenshots alter column original_bucket set default 'screenshot-uploads';

-- Avatar reservations are recorded like file and screenshot reservations, so
-- the processor only accepts keys the server handed out and quotas see them.
create table public.avatar_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_key text not null unique check (storage_key ~ '^avatars/[0-9a-f-]{36}/[0-9a-f-]{36}\.bin$'),
  declared_size_bytes bigint not null check (declared_size_bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index avatar_uploads_user_idx on public.avatar_uploads (user_id, created_at desc);
alter table public.avatar_uploads enable row level security;
-- Written only by the server and the processor (secret key). No client access.
revoke all on public.avatar_uploads from public, anon, authenticated;

-- Signed upload URLs stay valid for two hours, so reservations count for that long.
create or replace function public.avatar_reservation_open(a public.avatar_uploads)
returns boolean
language sql
stable
set search_path = ''
as $$
  select a.status = 'pending' and a.created_at > now() - interval '2 hours';
$$;
revoke all on function public.avatar_reservation_open(public.avatar_uploads) from public, anon, authenticated;

-- Storage usage from the objects that really exist (storage.objects size
-- metadata), plus reservations whose object has not arrived yet at their
-- declared size, so parallel reservations cannot overshoot the allowance.
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
  with obj as (
    select o.bucket_id, o.name, coalesce((o.metadata ->> 'size')::bigint, 0) as size
      from storage.objects o
     where o.bucket_id in ('quarantine', 'screenshot-uploads', 'avatar-uploads', 'previews')
  ),
  reserved as (
    select 'file'::text as kind, f.declared_size_bytes as size
      from public.template_files f
     where f.is_current and f.validation_status = 'pending'
       and not exists (select 1 from obj where obj.bucket_id = f.storage_bucket and obj.name = f.storage_key)
    union all
    select 'image', s.declared_size_bytes
      from public.template_screenshots s
     where s.status = 'pending'
       and not exists (select 1 from obj where obj.bucket_id = s.original_bucket and obj.name = s.original_key)
    union all
    select 'image', a.declared_size_bytes
      from public.avatar_uploads a
     where public.avatar_reservation_open(a)
       and not exists (select 1 from obj where obj.bucket_id = 'avatar-uploads' and obj.name = a.storage_key)
  ),
  totals as (
    select
      coalesce((select sum(size) from obj where bucket_id = 'quarantine' and name like 'files/%'), 0)
        + coalesce((select sum(size) from reserved where kind = 'file'), 0) as f,
      coalesce((select sum(size) from obj where not (bucket_id = 'quarantine' and name like 'files/%')), 0)
        + coalesce((select sum(size) from reserved where kind = 'image'), 0) as s
  )
  select totals.f::bigint, totals.s::bigint, (totals.f + totals.s)::bigint,
    (select count(*) from public.template_files where is_current and scan_status = 'pending' and validation_status = 'passed'),
    (select count(*) from public.templates where publication_status = 'pending'),
    (select count(*) from public.reports where status = 'open')
  from totals;
$$;

-- Per-user usage: every object under the user's listings (by key prefix, so
-- objects re-uploaded outside a reservation count too), their avatar, and
-- their open reservations that have not been uploaded yet.
create or replace function public.user_storage_usage(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select t.id::text as id from public.templates t where t.creator_id = p_user_id
  ),
  obj as (
    select o.bucket_id, o.name, coalesce((o.metadata ->> 'size')::bigint, 0) as size
      from storage.objects o
     where (o.bucket_id in ('quarantine', 'screenshot-uploads')
            and split_part(o.name, '/', 1) in ('files', 'screenshots')
            and split_part(o.name, '/', 2) in (select id from mine))
        or (o.bucket_id = 'previews' and split_part(o.name, '/', 1) = 'shots'
            and split_part(o.name, '/', 2) in (select id from mine))
        or (o.bucket_id in ('avatar-uploads', 'quarantine') and o.name like 'avatars/' || p_user_id::text || '/%')
        or (o.bucket_id = 'previews' and o.name = (select p.avatar_key from public.profiles p where p.id = p_user_id))
  ),
  reserved as (
    select f.declared_size_bytes as size
      from public.template_files f
     where f.uploader_id = p_user_id and f.is_current and f.validation_status = 'pending'
       and not exists (select 1 from storage.objects o where o.bucket_id = f.storage_bucket and o.name = f.storage_key)
    union all
    select s.declared_size_bytes
      from public.template_screenshots s
     where s.uploader_id = p_user_id and s.status = 'pending'
       and not exists (select 1 from storage.objects o where o.bucket_id = s.original_bucket and o.name = s.original_key)
    union all
    select a.declared_size_bytes
      from public.avatar_uploads a
     where a.user_id = p_user_id and public.avatar_reservation_open(a)
       and not exists (select 1 from storage.objects o where o.bucket_id = 'avatar-uploads' and o.name = a.storage_key)
  )
  select (coalesce((select sum(size) from obj), 0) + coalesce((select sum(size) from reserved), 0))::bigint;
$$;

-- Deletes reservations that never completed and returns how many. Their
-- objects (if any) become orphans that storage_orphans() reports.
create or replace function public.cleanup_stale_uploads()
returns table (files int, screenshots int, avatars int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_files int;
  n_shots int;
  n_avatars int;
begin
  delete from public.template_files where validation_status = 'pending' and created_at < now() - interval '24 hours';
  get diagnostics n_files = row_count;
  delete from public.template_screenshots where status = 'pending' and created_at < now() - interval '24 hours';
  get diagnostics n_shots = row_count;
  delete from public.avatar_uploads where created_at < now() - interval '2 days';
  get diagnostics n_avatars = row_count;
  if n_files + n_shots + n_avatars > 0 then
    perform public.log_event('maintenance:cleanup_stale_uploads', null, null,
      jsonb_build_object('files', n_files, 'screenshots', n_shots, 'avatars', n_avatars));
  end if;
  return query select n_files, n_shots, n_avatars;
end;
$$;

-- Objects that no live record needs: re-uploads to keys that were already
-- processed or rejected, reservations that were cleaned up, objects of deleted
-- listings and failed processor writes. Objects must be deleted through the
-- Storage API, so this only lists them (oldest first).
create or replace function public.storage_orphans(p_min_age interval default interval '1 hour', p_limit int default 1000)
returns table (bucket_id text, name text, size bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name, coalesce((o.metadata ->> 'size')::bigint, 0)
    from storage.objects o
   where o.bucket_id in ('quarantine', 'screenshot-uploads', 'avatar-uploads', 'previews')
     and o.created_at < now() - p_min_age
     and not (
       (o.bucket_id = 'quarantine' and exists (
          select 1 from public.template_files f
           where f.storage_key = o.name and f.is_current and f.validation_status in ('pending', 'passed')))
       or (o.bucket_id in ('quarantine', 'screenshot-uploads') and exists (
          select 1 from public.template_screenshots s
           where s.original_bucket = o.bucket_id and s.original_key = o.name and s.status = 'pending'))
       or (o.bucket_id = 'avatar-uploads' and exists (
          select 1 from public.avatar_uploads a where a.storage_key = o.name and public.avatar_reservation_open(a)))
       or (o.bucket_id = 'previews' and (
          exists (select 1 from public.template_screenshots s where s.public_key = o.name or s.thumb_key = o.name)
          or exists (select 1 from public.profiles p where p.avatar_key = o.name)))
     )
   order by o.created_at
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

revoke all on function public.storage_usage() from public, anon, authenticated;
revoke all on function public.user_storage_usage(uuid) from public, anon, authenticated;
revoke all on function public.cleanup_stale_uploads() from public, anon, authenticated;
revoke all on function public.storage_orphans(interval, int) from public, anon, authenticated;
grant execute on function public.storage_usage() to service_role;
grant execute on function public.user_storage_usage(uuid) to service_role;
grant execute on function public.cleanup_stale_uploads() to service_role;
grant execute on function public.storage_orphans(interval, int) to service_role;

-- ===========================================================================
-- 2. Rejected or removed listings wait for a moderator
-- ===========================================================================
alter table public.templates add column requires_review boolean not null default false;
-- Clients never get UPDATE or INSERT on this column (the existing grants are
-- column lists without it). A trigger keeps it unchanged for client requests
-- too, in case a broader grant is ever added by mistake.
create or replace function public.templates_guard_requires_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requires_review is distinct from old.requires_review
     and coalesce(auth.jwt() ->> 'role', '') in ('anon', 'authenticated')
     and not public.is_staff() then
    new.requires_review := old.requires_review;
  end if;
  return new;
end;
$$;
create trigger templates_guard_review before update on public.templates
  for each row execute function public.templates_guard_requires_review();
revoke all on function public.templates_guard_requires_review() from public, anon, authenticated;

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
           moderation_note = nullif(trim(coalesce(p_reason, '')), ''), requires_review = false
     where id = t.id;
    new_status := 'approved';
  elsif p_action = 'reject' then
    if coalesce(char_length(trim(p_reason)), 0) < 5 then
      raise exception 'A rejection reason is required' using errcode = 'P0001';
    end if;
    update public.template_files set approved_sha256 = null where template_id = t.id;
    update public.templates
       set publication_status = 'rejected', approved_at = null, approved_by = null, moderation_note = trim(p_reason),
           requires_review = true
     where id = t.id;
    new_status := 'rejected';
  elsif p_action = 'remove' then
    if coalesce(char_length(trim(p_reason)), 0) < 5 then
      raise exception 'A removal reason is required' using errcode = 'P0001';
    end if;
    update public.template_files set approved_sha256 = null where template_id = t.id;
    update public.templates
       set publication_status = 'removed', approved_at = null, approved_by = null, moderation_note = trim(p_reason),
           requires_review = true
     where id = t.id;
    new_status := 'removed';
  else
    raise exception 'Unknown moderation action' using errcode = 'P0001';
  end if;

  perform public.log_event('moderation:' || p_action, t.id, null, jsonb_build_object('reason', p_reason));
  return new_status;
end;
$$;
revoke all on function public.moderate_template(uuid, text, text) from public, anon;
grant execute on function public.moderate_template(uuid, text, text) to authenticated;

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
  -- A moderator rejected or removed this listing: only a moderator can publish it again.
  if t.requires_review then
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
       or f.scanned_sha256 is null or f.scanned_sha256 <> f.sha256
       -- Compiled code is never published without a person looking at it.
       or f.contains_code)
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

-- ===========================================================================
-- 4. Least-privilege scanner account
-- ===========================================================================
-- Not readable or writable through client grants; set by the deploy workflow
-- (scripts/ci-setup.mjs) with direct SQL.
alter table public.profiles add column is_scanner boolean not null default false;

create or replace function public.is_scanner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_scanner and not p.is_banned
  );
$$;
revoke all on function public.is_scanner() from public, anon, authenticated;
grant execute on function public.is_scanner() to authenticated;

-- The scanner sees only files that wait for a scan, and only their bytes.
create policy template_files_read_scanner on public.template_files for select to authenticated
  using (
    (select public.is_scanner())
    and is_current and validation_status = 'passed' and scan_status = 'pending'
  );
create policy quarantine_scanner_read on storage.objects for select to authenticated
  using (
    bucket_id = 'quarantine'
    and (select public.is_scanner())
    and exists (
      select 1 from public.template_files f
       where f.storage_key = objects.name and f.is_current
         and f.validation_status = 'passed' and f.scan_status = 'pending'
    )
  );

-- Staff record any result; the scanner records a result only for a file
-- that has none yet, so it can never overwrite a moderator's decision.
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
  staff boolean := public.is_staff();
begin
  if not staff and not public.is_scanner() then
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
  if not staff and f.scan_status <> 'pending' then
    raise exception 'This file already has a scan result' using errcode = '42501';
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
revoke all on function public.record_scan_result(uuid, public.scan_status, text, text, text, text, timestamptz, text, text) from public, anon;
grant execute on function public.record_scan_result(uuid, public.scan_status, text, text, text, text, timestamptz, text, text) to authenticated;

-- ===========================================================================
-- 5. Daily cap on new listings, also for direct API inserts
-- ===========================================================================
-- Matches LIMIT_PER_USER_DAILY_SUBMISSIONS (default 5). Change both together.
alter table public.site_settings
  add column max_daily_submissions int not null default 5 check (max_daily_submissions between 1 and 1000);

create or replace function public.templates_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap int;
begin
  -- The server's secret key (seed scripts, maintenance) is not limited.
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated') then
    return new;
  end if;
  -- One creator at a time, so parallel inserts cannot pass the check together.
  perform pg_advisory_xact_lock(hashtextextended('templates_insert:' || new.creator_id::text, 0));
  cap := coalesce((select s.max_daily_submissions from public.site_settings s where s.id = 1), 5);
  if (select count(*) from public.templates t
      where t.creator_id = new.creator_id and t.created_at > now() - interval '24 hours') >= cap then
    raise exception 'Daily upload limit reached, try again tomorrow' using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end;
$$;
create trigger templates_guard_insert before insert on public.templates
  for each row execute function public.templates_guard_insert();
revoke all on function public.templates_guard_insert() from public, anon, authenticated;

-- ===========================================================================
-- 7. Suspended users
-- ===========================================================================
drop policy favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
    and exists (select 1 from public.templates t where t.id = template_id and t.publication_status = 'approved')
  );

-- Reviews by suspended accounts are hidden from the public and do not count.
drop policy reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to anon, authenticated
  using (
    (not is_hidden and exists (select 1 from public.profiles p where p.id = author_id and not p.is_banned))
    or author_id = (select auth.uid())
    or (select public.is_staff())
  );

create or replace function public.refresh_rating(p_template_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.templates t set
    rating_count = s.cnt,
    rating_avg = coalesce(s.avg, 0)
  from (
    select count(*)::int as cnt, round(avg(r.rating)::numeric, 2) as avg
      from public.reviews r
      join public.profiles p on p.id = r.author_id
     where r.template_id = p_template_id and not r.is_hidden and not p.is_banned
  ) s
  where t.id = p_template_id;
$$;
revoke all on function public.refresh_rating(uuid) from public, anon, authenticated;

create or replace function public.reviews_refresh_aggregate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_rating(coalesce(new.template_id, old.template_id));
  return null;
end;
$$;
revoke all on function public.reviews_refresh_aggregate() from public, anon, authenticated;

-- Suspending or restoring an account recalculates the ratings it touched.
create or replace function public.profiles_after_ban_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tid uuid;
begin
  for tid in select distinct r.template_id from public.reviews r where r.author_id = new.id loop
    perform public.refresh_rating(tid);
  end loop;
  return null;
end;
$$;
create trigger profiles_ban_change after update of is_banned on public.profiles
  for each row when (new.is_banned is distinct from old.is_banned)
  execute function public.profiles_after_ban_change();
revoke all on function public.profiles_after_ban_change() from public, anon, authenticated;

-- Bring existing aggregates in line with the new rule.
do $$
declare
  tid uuid;
begin
  for tid in select distinct r.template_id from public.reviews r
             join public.profiles p on p.id = r.author_id where p.is_banned loop
    perform public.refresh_rating(tid);
  end loop;
end
$$;

-- ===========================================================================
-- Comments and follows: exactly the privileges 20261019000300 intends.
-- REVOKE ALL on a table also drops any column-level privileges.
-- ===========================================================================
revoke all on public.comments from public, anon, authenticated;
grant select on public.comments to anon, authenticated;
grant insert (template_id, author_id, parent_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;
grant delete on public.comments to authenticated;

revoke all on public.follows from public, anon, authenticated;
grant select, insert, delete on public.follows to authenticated;
-- search_templates references follows in its plan; RLS returns no rows to anon.
grant select on public.follows to anon;

-- Verification. The same query can be run by hand at any time:
--   select grantee, table_name, privilege_type, column_name
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name in ('comments', 'follows')
--      and grantee in ('anon', 'authenticated')
--    order by 1, 2, 3, 4;
do $$
declare
  unexpected text;
begin
  select string_agg(format('%s %s %s.%s', grantee, privilege_type, table_name, column_name), ', ')
    into unexpected
    from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('comments', 'follows')
     and grantee in ('anon', 'authenticated')
     and not (
       privilege_type = 'SELECT'
       or (table_name = 'follows' and grantee = 'authenticated' and privilege_type in ('INSERT', 'DELETE'))
       or (table_name = 'comments' and grantee = 'authenticated' and privilege_type = 'INSERT'
           and column_name in ('template_id', 'author_id', 'parent_id', 'body'))
       or (table_name = 'comments' and grantee = 'authenticated' and privilege_type = 'UPDATE' and column_name = 'body')
     );
  if unexpected is not null then
    raise exception 'Unexpected client privileges: %', unexpected;
  end if;
end
$$;
