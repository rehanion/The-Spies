-- Duplicate files. When a file's hash matches a file in another listing, the
-- new file points at the earliest one (duplicate_of) and its listing waits for
-- a moderator. Readmes and tiny files are ignored because they match by chance.

alter table public.template_files
  add column duplicate_of uuid references public.template_files (id) on delete set null;
create index template_files_sha256_idx on public.template_files (sha256) where sha256 is not null;

create or replace function public.template_files_find_duplicate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sha256 is null or new.sha256 is not distinct from old.sha256 then
    return new;
  end if;
  new.duplicate_of := null;
  if new.extension in ('txt', 'md') or coalesce(new.size_bytes, 0) < 64 then
    return new;
  end if;
  select f.id into new.duplicate_of
    from public.template_files f
    join public.templates t on t.id = f.template_id
   where f.sha256 = new.sha256
     and f.template_id <> new.template_id
     and f.validation_status = 'passed'
     and t.publication_status <> 'removed'
   order by (t.publication_status = 'approved') desc, f.created_at
   limit 1;
  return new;
end;
$$;
create trigger template_files_duplicate before update of sha256 on public.template_files
  for each row execute function public.template_files_find_duplicate();
revoke all on function public.template_files_find_duplicate() from public, anon, authenticated;

-- What the uploader (or staff) may learn about the earlier copy. Another
-- creator's listing is only named when it is public.
create or replace function public.file_duplicate_info(p_file_id uuid)
returns table (template_title text, template_slug text, same_creator boolean, is_public boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  dup uuid;
begin
  select t.creator_id, f.duplicate_of into owner, dup
    from public.template_files f join public.templates t on t.id = f.template_id
   where f.id = p_file_id;
  if dup is null or me is null or (owner is distinct from me and not public.is_staff()) then
    return;
  end if;
  return query
    select case when t.publication_status = 'approved' or t.creator_id = me or public.is_staff() then t.title end,
           case when t.publication_status = 'approved' or t.creator_id = me or public.is_staff() then t.slug end,
           t.creator_id = owner,
           t.publication_status = 'approved'
      from public.template_files f join public.templates t on t.id = f.template_id
     where f.id = dup;
end;
$$;
revoke all on function public.file_duplicate_info(uuid) from public, anon, authenticated;
grant execute on function public.file_duplicate_info(uuid) to authenticated;

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
       -- Compiled code and file types SPIES cannot check wait for a person.
       or f.contains_code or f.needs_review
       -- The same file is already on SPIES: a person checks who really made it.
       or f.duplicate_of is not null)
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
