-- Row Level Security, explicit grants, and storage buckets/policies.

alter table public.profiles enable row level security;
alter table public.platforms enable row level security;
alter table public.categories enable row level security;
alter table public.templates enable row level security;
alter table public.template_files enable row level security;
alter table public.template_screenshots enable row level security;
alter table public.scan_records enable row level security;
alter table public.reviews enable row level security;
alter table public.favorites enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_events enable row level security;
alter table public.download_events enable row level security;
alter table public.rate_limits enable row level security;

-- Start from nothing for client roles, then grant the minimum.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reference data: readable by everyone.
-- ---------------------------------------------------------------------------
grant select on public.platforms, public.categories to anon, authenticated;
create policy platforms_read on public.platforms for select to anon, authenticated using (true);
create policy categories_read on public.categories for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Profiles: public columns readable by all; users edit only their own
-- non-privileged columns (column grants exclude role/is_banned/is_demo).
-- ---------------------------------------------------------------------------
grant select (id, username, display_name, bio, avatar_key, role, is_banned, is_demo, created_at) on public.profiles to anon, authenticated;
grant update (username, display_name, bio) on public.profiles to authenticated;

create policy profiles_read on public.profiles for select to anon, authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and not is_banned)
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
grant select on public.templates to anon, authenticated;
grant insert (slug, creator_id, title, summary, description, platform_id, platform_version, category_id, tags,
              dependencies, install_steps, license_code, license_text, rights_attested)
  on public.templates to authenticated;
grant update (title, summary, description, platform_id, platform_version, category_id, tags,
              dependencies, install_steps, license_code, license_text, rights_attested, cover_screenshot_id)
  on public.templates to authenticated;
grant delete on public.templates to authenticated;

create policy templates_read_public on public.templates for select to anon, authenticated
  using (
    publication_status = 'approved'
    and exists (select 1 from public.profiles p where p.id = creator_id and not p.is_banned)
  );
create policy templates_read_own on public.templates for select to authenticated
  using (creator_id = (select auth.uid()));
create policy templates_read_staff on public.templates for select to authenticated
  using ((select public.is_staff()));
create policy templates_insert_own on public.templates for insert to authenticated
  with check (creator_id = (select auth.uid()) and (select public.is_active_user()));
create policy templates_update_own on public.templates for update to authenticated
  using (creator_id = (select auth.uid()) and publication_status <> 'removed' and (select public.is_active_user()))
  with check (creator_id = (select auth.uid()));
create policy templates_delete_own on public.templates for delete to authenticated
  using (creator_id = (select auth.uid()) and publication_status in ('draft', 'pending', 'rejected'));

-- ---------------------------------------------------------------------------
-- Template files: metadata only. Rows are created/changed by the trusted
-- server (secret key) and by SECURITY DEFINER functions, never directly.
-- ---------------------------------------------------------------------------
grant select on public.template_files to anon, authenticated;

create policy template_files_read_public on public.template_files for select to anon, authenticated
  using (
    is_current and exists (
      select 1 from public.templates t
      where t.id = template_id and t.publication_status = 'approved'
        and exists (select 1 from public.profiles p where p.id = t.creator_id and not p.is_banned)
    )
  );
create policy template_files_read_own on public.template_files for select to authenticated
  using (uploader_id = (select auth.uid()));
create policy template_files_read_staff on public.template_files for select to authenticated
  using ((select public.is_staff()));

-- ---------------------------------------------------------------------------
-- Screenshots: creators may edit caption only (ordering via RPC).
-- ---------------------------------------------------------------------------
grant select on public.template_screenshots to anon, authenticated;
grant update (caption) on public.template_screenshots to authenticated;

create policy screenshots_read_public on public.template_screenshots for select to anon, authenticated
  using (
    status = 'ready' and exists (
      select 1 from public.templates t
      where t.id = template_id and t.publication_status = 'approved'
        and exists (select 1 from public.profiles p where p.id = t.creator_id and not p.is_banned)
    )
  );
create policy screenshots_read_own on public.template_screenshots for select to authenticated
  using (uploader_id = (select auth.uid()));
create policy screenshots_read_staff on public.template_screenshots for select to authenticated
  using ((select public.is_staff()));
create policy screenshots_update_own on public.template_screenshots for update to authenticated
  using (uploader_id = (select auth.uid()) and exists (
    select 1 from public.templates t where t.id = template_id and t.publication_status <> 'removed'))
  with check (uploader_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Scan records: staff, plus the uploader of the file.
-- ---------------------------------------------------------------------------
grant select on public.scan_records to authenticated;
create policy scan_records_read_staff on public.scan_records for select to authenticated
  using ((select public.is_staff()));
create policy scan_records_read_owner on public.scan_records for select to authenticated
  using (exists (select 1 from public.template_files f where f.id = file_id and f.uploader_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
grant select on public.reviews to anon, authenticated;
grant insert (template_id, author_id, rating, body) on public.reviews to authenticated;
grant update (rating, body) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;

create policy reviews_read on public.reviews for select to anon, authenticated
  using (not is_hidden or author_id = (select auth.uid()) or (select public.is_staff()));
create policy reviews_insert_own on public.reviews for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (select public.is_active_user())
    and exists (select 1 from public.templates t where t.id = template_id and t.publication_status = 'approved')
  );
create policy reviews_update_own on public.reviews for update to authenticated
  using (author_id = (select auth.uid()) and (select public.is_active_user()))
  with check (author_id = (select auth.uid()));
create policy reviews_delete_own on public.reviews for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_staff()));

-- ---------------------------------------------------------------------------
-- Favorites: private to their owner.
-- ---------------------------------------------------------------------------
grant select, insert, delete on public.favorites to authenticated;
create policy favorites_read_own on public.favorites for select to authenticated
  using (user_id = (select auth.uid()));
create policy favorites_insert_own on public.favorites for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.templates t where t.id = template_id and t.publication_status = 'approved')
  );
create policy favorites_delete_own on public.favorites for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Reports: inserted by the trusted server (Turnstile + rate limit);
-- reporters can read their own, staff read all.
-- ---------------------------------------------------------------------------
grant select on public.reports to authenticated;
create policy reports_read_own on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));
create policy reports_read_staff on public.reports for select to authenticated
  using ((select public.is_staff()));

-- ---------------------------------------------------------------------------
-- Audit log and download events: staff read-only; nobody edits via the API.
-- ---------------------------------------------------------------------------
grant select on public.moderation_events to authenticated;
create policy moderation_events_read_staff on public.moderation_events for select to authenticated
  using ((select public.is_staff()));

grant select on public.download_events to authenticated;
create policy download_events_read_own on public.download_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy download_events_read_staff on public.download_events for select to authenticated
  using ((select public.is_staff()));

-- rate_limits: no client access at all (RLS on, no policies, no grants).

-- ---------------------------------------------------------------------------
-- Function execute grants
-- ---------------------------------------------------------------------------
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_active_user() to anon, authenticated;
grant execute on function public.file_download_state(uuid) to anon, authenticated;
grant execute on function public.search_templates(text, text, text, text, int, int, uuid) to anon, authenticated;
grant execute on function public.submit_template(uuid) to authenticated;
grant execute on function public.withdraw_template(uuid) to authenticated;
grant execute on function public.reorder_screenshots(uuid, uuid[]) to authenticated;
grant execute on function public.moderate_template(uuid, text, text) to authenticated;
grant execute on function public.record_scan_result(uuid, public.scan_status, text, text, text, text, timestamptz, text, text) to authenticated;
grant execute on function public.resolve_report(uuid, public.report_status, text) to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_set_banned(uuid, boolean, text) to authenticated;
-- Service-only: consume_rate_limit, register_download, storage_usage, user_storage_usage, log_event
-- are executable by service_role (and postgres) only.
grant execute on function public.consume_rate_limit(text, int, int) to service_role;
grant execute on function public.register_download(uuid, text, uuid) to service_role;
grant execute on function public.storage_usage() to service_role;
grant execute on function public.user_storage_usage(uuid) to service_role;
grant execute on function public.log_event(text, uuid, uuid, jsonb, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- Storage buckets
--   quarantine: private originals (template files + original screenshots).
--               No client policies: uploads use server-issued signed upload
--               URLs; downloads use server-issued short-lived signed URLs.
--               Staff may read objects for manual scanning.
--   previews:   public, holds only server re-encoded raster images.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('quarantine', 'quarantine', false, 20971520, array['application/octet-stream']),
  ('previews', 'previews', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy quarantine_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'quarantine' and (select public.is_staff()));
