-- Platforms can accept "other" files (anything that is not a program, script,
-- installer or archive) and MotiveWave .tml templates. Files of a type SPIES
-- cannot check are marked needs_review and their listing waits for a moderator.

create or replace function public.known_file_formats()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['mwml', 'tml', 'cht', 'stdycollct', 'twconfig', 'xml', 'json', 'zip', 'txt', 'md', 'pine', 'dll', 'jar', 'other']::text[];
$$;

alter table public.template_files add column needs_review boolean not null default false;

-- Every platform takes .txt notes and other files; MotiveWave also takes .tml.
update public.platforms
   set upload_formats = (select array_agg(distinct x order by x) from unnest(upload_formats || array['txt', 'other']) x),
       zip_formats = (select array_agg(distinct x order by x) from unnest(zip_formats || array['txt', 'other']) x);
update public.platforms
   set upload_formats = (select array_agg(distinct x order by x) from unnest(upload_formats || array['tml']) x),
       zip_formats = (select array_agg(distinct x order by x) from unnest(zip_formats || array['tml']) x)
 where id = 'motivewave';

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
       or f.contains_code or f.needs_review)
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
