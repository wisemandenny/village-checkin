-- Multiple device IDs per villager (issue #94)
-- Incremental, idempotent migration for an existing database.
--
-- The single `device_id text unique` column becomes `device_ids text[]` so one
-- account can hold several devices and any of them matches at sign-in. A GIN
-- exclusion constraint on array overlap (&&) keeps a device from ever belonging
-- to two villagers, and the same index accelerates containment (@>) lookups.

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

-- Global uniqueness: no device id may appear in two villagers' arrays.
alter table villagers
  add constraint villagers_device_ids_no_overlap
  exclude using gin (device_ids with &&);
