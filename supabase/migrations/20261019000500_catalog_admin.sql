-- Platforms and categories become editable by admins. Each platform stores
-- which file formats it accepts; the upload processor reads them from here.
-- Listings that contain compiled code (.dll, .jar) always wait for a moderator.

-- Formats the upload processor knows how to validate (supabase/functions/_shared/formats.ts).
create or replace function public.known_file_formats()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['mwml', 'cht', 'stdycollct', 'twconfig', 'xml', 'json', 'zip', 'txt', 'md', 'pine', 'dll', 'jar']::text[];
$$;

alter table public.platforms
  add column upload_formats text[] not null default '{}',
  add column zip_formats text[] not null default '{}',
  add column install_hint text not null default '' check (char_length(install_hint) <= 500);
alter table public.platforms
  add constraint platforms_upload_formats_known check (upload_formats <@ public.known_file_formats()),
  add constraint platforms_zip_formats_known check (zip_formats <@ public.known_file_formats() and not zip_formats && array['zip', 'jar']),
  add constraint platforms_name_len check (char_length(name) between 2 and 40),
  add constraint platforms_description_len check (char_length(description) <= 300),
  add constraint platforms_website_https check (website = '' or website ~ '^https://[^\s]{3,200}$');
alter table public.categories
  add constraint categories_name_len check (char_length(name) between 2 and 40),
  add constraint categories_description_len check (char_length(description) <= 300);

update public.platforms set upload_formats = '{mwml,zip,jar}', zip_formats = '{mwml,txt,md}' where id = 'motivewave';
update public.platforms set upload_formats = '{cht,stdycollct,twconfig,zip,dll}', zip_formats = '{cht,stdycollct,twconfig,txt,md,dll}' where id = 'sierra-chart';
update public.platforms set upload_formats = '{xml,zip,dll}', zip_formats = '{xml,txt,md,dll}' where id = 'quantower';

insert into public.platforms (id, name, website, description, sort_order, upload_formats, zip_formats) values
  ('atas', 'ATAS', 'https://atas.net', 'Chart templates, workspaces and indicator plugins', 40, '{xml,zip,dll}', '{xml,txt,md,dll}'),
  ('tradingview', 'TradingView', 'https://www.tradingview.com', 'Pine Script indicators and strategies', 50, '{pine,txt}', '{pine,txt,md}')
on conflict (id) do nothing;

insert into public.categories (id, name, description, sort_order) values
  ('tpo', 'TPO', 'TPO and Market Profile charts', 15),
  ('order-flow', 'Order Flow', 'Order flow tools, heatmaps and tape', 35),
  ('vwap', 'VWAP', 'VWAP, anchored VWAP and bands', 65),
  ('strategies', 'Strategies', 'Automated and semi-automated strategies', 75)
on conflict (id) do nothing;

-- Files with compiled code are marked by the upload processor.
alter table public.template_files add column contains_code boolean not null default false;

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

-- Admin editing. Ids are permanent once created because listings reference them.
create or replace function public.admin_save_platform(
  p_id text, p_name text, p_website text, p_description text, p_install_hint text,
  p_upload_formats text[], p_zip_formats text[], p_sort_order int, p_is_active boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit platforms' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_upload_formats), 0) = 0 then
    raise exception 'Choose at least one file type' using errcode = '22023';
  end if;
  insert into public.platforms (id, name, website, description, install_hint, upload_formats, zip_formats, sort_order, is_active)
  values (p_id, trim(p_name), trim(coalesce(p_website, '')), trim(coalesce(p_description, '')), trim(coalesce(p_install_hint, '')),
          p_upload_formats, coalesce(p_zip_formats, '{}'), coalesce(p_sort_order, 100), coalesce(p_is_active, true))
  on conflict (id) do update set
    name = excluded.name, website = excluded.website, description = excluded.description,
    install_hint = excluded.install_hint, upload_formats = excluded.upload_formats,
    zip_formats = excluded.zip_formats, sort_order = excluded.sort_order, is_active = excluded.is_active;
  perform public.log_event('platform:save', null, null, jsonb_build_object('id', p_id));
end;
$$;

create or replace function public.admin_save_category(p_id text, p_name text, p_description text, p_sort_order int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit categories' using errcode = '42501';
  end if;
  insert into public.categories (id, name, description, sort_order)
  values (p_id, trim(p_name), trim(coalesce(p_description, '')), coalesce(p_sort_order, 100))
  on conflict (id) do update set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;
  perform public.log_event('category:save', null, null, jsonb_build_object('id', p_id));
end;
$$;

create or replace function public.admin_delete_category(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete categories' using errcode = '42501';
  end if;
  if exists (select 1 from public.templates where category_id = p_id) then
    raise exception 'This category is used by listings. Rename it instead.' using errcode = 'P0001';
  end if;
  delete from public.categories where id = p_id;
  perform public.log_event('category:delete', null, null, jsonb_build_object('id', p_id));
end;
$$;

revoke all on function public.admin_save_platform(text, text, text, text, text, text[], text[], int, boolean) from public, anon;
revoke all on function public.admin_save_category(text, text, text, int) from public, anon;
revoke all on function public.admin_delete_category(text) from public, anon;
grant execute on function public.admin_save_platform(text, text, text, text, text, text[], text[], int, boolean) to authenticated;
grant execute on function public.admin_save_category(text, text, text, int) to authenticated;
grant execute on function public.admin_delete_category(text) to authenticated;

-- New listings can only use active platforms.
create or replace function public.templates_check_platform_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.platform_id is distinct from old.platform_id)
     and not exists (select 1 from public.platforms p where p.id = new.platform_id and p.is_active) then
    raise exception 'This platform is not accepting uploads' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger templates_platform_active before insert or update of platform_id on public.templates
  for each row execute function public.templates_check_platform_active();
revoke all on function public.templates_check_platform_active() from public, anon, authenticated;
