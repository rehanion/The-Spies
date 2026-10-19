-- SPIES core schema: profiles, catalog, files, screenshots, scans, community, audit.
-- Every table has RLS enabled. Privileged state changes go through SECURITY DEFINER
-- functions that re-check the caller's role from public.profiles (never from JWT metadata).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('user', 'moderator', 'admin');
create type public.publication_status as enum ('draft', 'pending', 'approved', 'rejected', 'removed');
create type public.scan_status as enum ('pending', 'clean', 'flagged', 'error');
create type public.validation_status as enum ('pending', 'passed', 'failed');
create type public.screenshot_status as enum ('pending', 'ready', 'failed');
create type public.report_kind as enum ('abuse', 'malware', 'copyright', 'spam', 'broken', 'other');
create type public.report_status as enum ('open', 'resolved', 'dismissed');

-- Lock down default privileges: we grant table/column access explicitly below.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  bio text not null default '' check (char_length(bio) <= 1000),
  avatar_key text check (avatar_key is null or avatar_key ~ '^avatars/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  role public.app_role not null default 'user',
  is_banned boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Role helpers. They read the role from the profiles table, so editing JWT
-- user_metadata can never grant privileges.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('moderator', 'admin') and not p.is_banned
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and not p.is_banned
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned);
$$;

-- Create a profile for every new auth user. The username comes from signup
-- metadata but is sanitised and de-duplicated here; role is always 'user'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  base := regexp_replace(base, '[^a-z0-9_]', '', 'g');
  base := left(base, 20);
  if char_length(base) < 3 then
    base := 'trader_' || left(replace(new.id::text, '-', ''), 8);
  end if;
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1;
    candidate := left(base, 19) || '_' || left(md5(new.id::text || n::text), 4);
  end loop;
  insert into public.profiles (id, username, display_name)
  values (new.id, candidate, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 60));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Reference data: platforms and categories
-- ---------------------------------------------------------------------------
create table public.platforms (
  id text primary key check (id ~ '^[a-z0-9-]{2,32}$'),
  name text not null,
  website text not null default '',
  description text not null default '',
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table public.categories (
  id text primary key check (id ~ '^[a-z0-9-]{2,32}$'),
  name text not null,
  description text not null default '',
  sort_order int not null default 0
);

insert into public.platforms (id, name, website, description, sort_order) values
  ('motivewave', 'MotiveWave', 'https://www.motivewave.com', 'Analyses (.mwml) and analysis packs', 10),
  ('sierra-chart', 'Sierra Chart', 'https://www.sierrachart.com', 'Chartbooks, study collections and trade window configs', 20),
  ('quantower', 'Quantower', 'https://www.quantower.com', 'Workspace and template XML files', 30);

insert into public.categories (id, name, description, sort_order) values
  ('footprint', 'Footprint', 'Footprint / cluster charts and bid-ask volume layouts', 10),
  ('volume-profile', 'Volume Profile', 'Session, composite and visible-range profiles', 20),
  ('dom', 'DOM', 'Depth of market ladders and trading DOM setups', 30),
  ('delta', 'Delta', 'Cumulative delta, delta bars and imbalance studies', 40),
  ('absorption', 'Absorption', 'Absorption, exhaustion and iceberg detection setups', 50),
  ('market-structure', 'Market Structure', 'Swing structure, auction market and value area tools', 60),
  ('indicators', 'Indicators', 'Indicator and study configurations', 70),
  ('workspaces', 'Workspaces', 'Complete multi-chart workspaces and chartbooks', 80),
  ('misc', 'Miscellaneous', 'Everything else', 90);

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 96),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  summary text not null default '' check (char_length(summary) <= 280),
  description text not null default '' check (char_length(description) <= 10000),
  platform_id text not null references public.platforms (id),
  platform_version text not null default '' check (char_length(platform_version) <= 60),
  category_id text not null references public.categories (id),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  dependencies text not null default '' check (char_length(dependencies) <= 2000),
  install_steps text not null default '' check (char_length(install_steps) <= 5000),
  license_code text not null default 'free-personal'
    check (license_code in ('free-personal', 'cc-by-4.0', 'cc-by-nc-4.0', 'cc0-1.0', 'mit', 'custom')),
  license_text text not null default '' check (char_length(license_text) <= 3000),
  rights_attested boolean not null default false,
  publication_status public.publication_status not null default 'draft',
  moderation_note text check (moderation_note is null or char_length(moderation_note) <= 2000),
  cover_screenshot_id uuid,
  download_count integer not null default 0 check (download_count >= 0),
  favorite_count integer not null default 0 check (favorite_count >= 0),
  rating_count integer not null default 0 check (rating_count >= 0),
  rating_avg numeric(3, 2) not null default 0,
  is_demo boolean not null default false,
  search_vector tsvector,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index templates_public_recent_idx on public.templates (approved_at desc) where publication_status = 'approved';
create index templates_public_downloads_idx on public.templates (download_count desc) where publication_status = 'approved';
create index templates_public_rating_idx on public.templates (rating_avg desc, rating_count desc) where publication_status = 'approved';
create index templates_status_idx on public.templates (publication_status, submitted_at);
create index templates_creator_idx on public.templates (creator_id, created_at desc);
create index templates_platform_idx on public.templates (platform_id);
create index templates_category_idx on public.templates (category_id);
create index templates_search_idx on public.templates using gin (search_vector);
create index templates_tags_idx on public.templates using gin (tags);

create trigger templates_touch before update on public.templates
  for each row execute function public.touch_updated_at();

-- Keep the search document current: title, tags, summary/description, creator,
-- platform and category names.
create or replace function public.templates_build_search()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator text;
  platform_name text;
  category_name text;
begin
  select p.username || ' ' || p.display_name into creator from public.profiles p where p.id = new.creator_id;
  select pl.name into platform_name from public.platforms pl where pl.id = new.platform_id;
  select c.name into category_name from public.categories c where c.id = new.category_id;
  new.search_vector :=
    setweight(to_tsvector('simple', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('simple', array_to_string(new.tags, ' ')), 'A') ||
    setweight(to_tsvector('simple', coalesce(creator, '') || ' ' || coalesce(platform_name, '') || ' ' || coalesce(category_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.summary, '')), 'C') ||
    setweight(to_tsvector('simple', left(coalesce(new.description, ''), 4000)), 'D');
  return new;
end;
$$;

create trigger templates_search before insert or update of title, tags, summary, description, platform_id, category_id, creator_id
  on public.templates for each row execute function public.templates_build_search();

-- Editing the content of an approved listing sends it back to moderation.
create or replace function public.templates_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.publication_status = 'approved' and new.publication_status = 'approved' and (
       new.title is distinct from old.title or new.summary is distinct from old.summary
    or new.description is distinct from old.description or new.platform_id is distinct from old.platform_id
    or new.platform_version is distinct from old.platform_version or new.category_id is distinct from old.category_id
    or new.tags is distinct from old.tags or new.dependencies is distinct from old.dependencies
    or new.install_steps is distinct from old.install_steps or new.license_code is distinct from old.license_code
    or new.license_text is distinct from old.license_text
  ) then
    new.publication_status := 'pending';
    new.approved_at := null;
    new.approved_by := null;
    new.submitted_at := now();
    new.moderation_note := 'Listing edited after approval; re-review required.';
  end if;
  return new;
end;
$$;

create trigger templates_guard before update on public.templates
  for each row execute function public.templates_guard_update();

-- ---------------------------------------------------------------------------
-- Template files (original uploads, always private)
-- ---------------------------------------------------------------------------
create table public.template_files (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  storage_bucket text not null default 'quarantine' check (storage_bucket = 'quarantine'),
  storage_key text not null unique check (storage_key ~ '^files/[0-9a-f-]{36}/[0-9a-f-]{36}\.bin$'),
  original_filename text not null check (char_length(original_filename) between 1 and 200),
  extension text not null check (extension ~ '^[a-z0-9]{1,16}$'),
  declared_size_bytes bigint not null check (declared_size_bytes > 0),
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  detected_format text,
  validation_status public.validation_status not null default 'pending',
  validation_report jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz,
  processed_at timestamptz,
  scan_status public.scan_status not null default 'pending',
  scanned_at timestamptz,
  scanner_name text,
  scanner_version text,
  signature_version text,
  scanned_sha256 text check (scanned_sha256 is null or scanned_sha256 ~ '^[0-9a-f]{64}$'),
  approved_sha256 text check (approved_sha256 is null or approved_sha256 ~ '^[0-9a-f]{64}$'),
  is_current boolean not null default true,
  superseded_at timestamptz,
  replaces_file_id uuid references public.template_files (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index template_files_template_idx on public.template_files (template_id) where is_current;
create index template_files_scan_queue_idx on public.template_files (scan_status, created_at) where is_current;
create unique index template_files_unique_name_idx on public.template_files (template_id, lower(original_filename)) where is_current;
create trigger template_files_touch before update on public.template_files
  for each row execute function public.touch_updated_at();

-- A change of stored content (hash) always resets scan and approval state.
create or replace function public.template_files_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sha256 is distinct from old.sha256 or new.storage_key is distinct from old.storage_key then
    new.scan_status := 'pending';
    new.scanned_at := null;
    new.scanner_name := null;
    new.scanner_version := null;
    new.signature_version := null;
    new.scanned_sha256 := null;
    new.approved_sha256 := null;
  end if;
  return new;
end;
$$;

create trigger template_files_guard before update on public.template_files
  for each row execute function public.template_files_guard_update();

-- ---------------------------------------------------------------------------
-- Screenshots (originals private; processed copies in the public previews bucket)
-- ---------------------------------------------------------------------------
create table public.template_screenshots (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  original_key text not null unique check (original_key ~ '^screenshots/[0-9a-f-]{36}/[0-9a-f-]{36}\.bin$'),
  public_key text unique check (public_key is null or public_key ~ '^shots/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  thumb_key text unique check (thumb_key is null or thumb_key ~ '^shots/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  caption text not null default '' check (char_length(caption) <= 200),
  position int not null default 0 check (position between 0 and 100),
  width int,
  height int,
  declared_size_bytes bigint not null check (declared_size_bytes > 0),
  size_bytes bigint,
  public_size_bytes bigint,
  status public.screenshot_status not null default 'pending',
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index template_screenshots_template_idx on public.template_screenshots (template_id, position);
create trigger template_screenshots_touch before update on public.template_screenshots
  for each row execute function public.touch_updated_at();

alter table public.templates
  add constraint templates_cover_fk foreign key (cover_screenshot_id)
  references public.template_screenshots (id) on delete set null;

-- The cover must belong to the same template.
create or replace function public.templates_check_cover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cover_screenshot_id is not null and not exists (
    select 1 from public.template_screenshots s
    where s.id = new.cover_screenshot_id and s.template_id = new.id
  ) then
    raise exception 'Cover screenshot must belong to this template' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger templates_cover_check before insert or update of cover_screenshot_id on public.templates
  for each row execute function public.templates_check_cover();

-- ---------------------------------------------------------------------------
-- Scan records (history of every manual or automated scan)
-- ---------------------------------------------------------------------------
create table public.scan_records (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.template_files (id) on delete cascade,
  result public.scan_status not null check (result in ('clean', 'flagged', 'error')),
  scanner_name text not null check (char_length(scanner_name) between 1 and 60),
  scanner_version text not null check (char_length(scanner_version) between 1 and 120),
  signature_version text not null check (char_length(signature_version) between 1 and 200),
  scanned_sha256 text not null check (scanned_sha256 ~ '^[0-9a-f]{64}$'),
  expected_sha256 text,
  hash_match boolean not null,
  notes text not null default '' check (char_length(notes) <= 2000),
  raw_output text not null default '' check (char_length(raw_output) <= 8000),
  recorded_by uuid references public.profiles (id) on delete set null,
  scanned_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index scan_records_file_idx on public.scan_records (file_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Reviews, favorites, reports
-- ---------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 2000),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, author_id)
);
create index reviews_template_idx on public.reviews (template_id, created_at desc);
create index reviews_author_idx on public.reviews (author_id, created_at desc);
create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_updated_at();

create table public.favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  template_id uuid not null references public.templates (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, template_id)
);
create index favorites_template_idx on public.favorites (template_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.templates (id) on delete set null,
  template_slug text,
  reporter_id uuid references public.profiles (id) on delete set null,
  kind public.report_kind not null,
  details text not null check (char_length(details) between 10 and 4000),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  claimant_name text check (claimant_name is null or char_length(claimant_name) <= 120),
  original_work_url text check (original_work_url is null or char_length(original_work_url) <= 500),
  good_faith_statement boolean not null default false,
  status public.report_status not null default 'open',
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at desc);
create index reports_template_idx on public.reports (template_id);

-- ---------------------------------------------------------------------------
-- Audit log (append-only) and download events
-- ---------------------------------------------------------------------------
create table public.moderation_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  template_id uuid,
  file_id uuid,
  target_user_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index moderation_events_template_idx on public.moderation_events (template_id, created_at desc);
create index moderation_events_recent_idx on public.moderation_events (created_at desc);

create or replace function public.log_event(
  p_action text, p_template_id uuid, p_file_id uuid, p_details jsonb default '{}'::jsonb, p_target_user uuid default null
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.moderation_events (actor_id, action, template_id, file_id, target_user_id, details)
  values (auth.uid(), p_action, p_template_id, p_file_id, p_target_user, coalesce(p_details, '{}'::jsonb));
$$;

create table public.download_events (
  id bigint generated always as identity primary key,
  file_id uuid not null references public.template_files (id) on delete cascade,
  template_id uuid not null references public.templates (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  actor_hash text not null,
  counted boolean not null,
  created_at timestamptz not null default now()
);
create index download_events_dedupe_idx on public.download_events (file_id, actor_hash, created_at desc);
create index download_events_user_idx on public.download_events (user_id, created_at desc);

create table public.rate_limits (
  bucket_key text primary key,
  window_start timestamptz not null,
  hits int not null
);

-- Every publication status change is audited, whichever path made it.
create or replace function public.templates_audit_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.publication_status is distinct from old.publication_status then
    perform public.log_event(
      'status:' || old.publication_status::text || '->' || new.publication_status::text,
      new.id, null,
      jsonb_build_object('note', new.moderation_note)
    );
  end if;
  return new;
end;
$$;
-- Not "update of publication_status": status changes made by the BEFORE
-- trigger templates_guard must be logged too.
create trigger templates_audit after update on public.templates
  for each row when (new.publication_status is distinct from old.publication_status)
  execute function public.templates_audit_status();

-- A new file on an approved/pending listing invalidates approval.
create or replace function public.template_files_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.templates t
     set publication_status = 'pending',
         approved_at = null,
         approved_by = null,
         moderation_note = 'Files changed after approval; re-review required.'
   where t.id = new.template_id and t.publication_status = 'approved';
  perform public.log_event('file:added', new.template_id, new.id,
    jsonb_build_object('filename', new.original_filename, 'replaces', new.replaces_file_id));
  return new;
end;
$$;
create trigger template_files_insert_invalidate after insert on public.template_files
  for each row execute function public.template_files_after_insert();

-- A new screenshot on an approved listing must be reviewed before it is public.
create or replace function public.template_screenshots_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.templates t
     set publication_status = 'pending',
         approved_at = null,
         approved_by = null,
         moderation_note = 'Screenshots changed after approval; re-review required.'
   where t.id = new.template_id and t.publication_status = 'approved';
  return new;
end;
$$;
create trigger template_screenshots_insert_invalidate after insert on public.template_screenshots
  for each row execute function public.template_screenshots_after_insert();

-- ---------------------------------------------------------------------------
-- Aggregates maintained by triggers
-- ---------------------------------------------------------------------------
create or replace function public.reviews_refresh_aggregate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tid uuid := coalesce(new.template_id, old.template_id);
begin
  update public.templates t set
    rating_count = s.cnt,
    rating_avg = coalesce(s.avg, 0)
  from (
    select count(*)::int as cnt, round(avg(rating)::numeric, 2) as avg
    from public.reviews r where r.template_id = tid and not r.is_hidden
  ) s
  where t.id = tid;
  return null;
end;
$$;
create trigger reviews_aggregate after insert or update or delete on public.reviews
  for each row execute function public.reviews_refresh_aggregate();

create or replace function public.favorites_refresh_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tid uuid := coalesce(new.template_id, old.template_id);
begin
  update public.templates t
     set favorite_count = (select count(*) from public.favorites f where f.template_id = tid)
   where t.id = tid;
  return null;
end;
$$;
create trigger favorites_count after insert or delete on public.favorites
  for each row execute function public.favorites_refresh_count();

-- Review spam control: one review per template (unique), not on your own
-- template, and at most 10 reviews per 24 hours per account.
create or replace function public.reviews_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.templates t where t.id = new.template_id and t.creator_id = new.author_id) then
    raise exception 'You cannot review your own template' using errcode = '42501';
  end if;
  if (select count(*) from public.reviews r
      where r.author_id = new.author_id and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Review limit reached, try again tomorrow' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger reviews_guard before insert on public.reviews
  for each row execute function public.reviews_guard_insert();

-- Profile username change refreshes the search document of their templates.
create or replace function public.profiles_after_rename()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is distinct from old.username or new.display_name is distinct from old.display_name then
    update public.templates set creator_id = creator_id where creator_id = new.id;
  end if;
  return null;
end;
$$;
create trigger profiles_rename after update of username, display_name on public.profiles
  for each row execute function public.profiles_after_rename();
