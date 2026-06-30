-- Multiple device IDs per villager (issue #94)
-- Incremental, idempotent migration for an existing database.
--
-- The single `device_id text unique` column becomes `device_ids text[]` so one
-- account can hold several devices and any of them matches at sign-in. A GIN
-- index accelerates the containment (@>) lookups, and a trigger keeps a device
-- from ever belonging to two villagers. (Postgres exclusion constraints only
-- support GiST/SP-GiST, not GIN, so a trigger is used for cross-row uniqueness.)

alter table villagers add column if not exists device_ids text[];

-- Backfill the array from the existing single column.
update villagers
  set device_ids = array[device_id]
  where device_id is not null and (device_ids is null or device_ids = '{}');

alter table villagers alter column device_ids set default '{}';
update villagers set device_ids = '{}' where device_ids is null;
alter table villagers alter column device_ids set not null;

-- Replace the old single-column unique index and column.
drop index if exists idx_villagers_device_id;
alter table villagers drop column if exists device_id;

-- GIN index for fast containment lookups (device_ids @> '{<id>}').
create index if not exists idx_villagers_device_ids on villagers using gin (device_ids);

-- Global uniqueness: no device id may appear in two villagers' arrays. Raised
-- with errcode unique_violation (23505) so the app maps it to the existing
-- "Device already registered" message.
create or replace function villagers_device_ids_unique()
returns trigger as $$
begin
  if new.device_ids is not null and array_length(new.device_ids, 1) is not null then
    if exists (
      select 1 from villagers v
      where v.id <> new.id and v.device_ids && new.device_ids
    ) then
      raise exception 'device_id already registered to another villager'
        using errcode = 'unique_violation';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_villagers_device_ids_unique on villagers;
create trigger trg_villagers_device_ids_unique
  before insert or update of device_ids on villagers
  for each row execute function villagers_device_ids_unique();
