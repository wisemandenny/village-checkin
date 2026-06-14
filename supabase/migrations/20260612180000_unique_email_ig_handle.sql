-- Unique email and Instagram handle on villagers
-- Incremental, idempotent migration for an existing database.
--
-- Duplicate display names are now allowed, so the old case-insensitive unique
-- index on display_name is dropped. In its place, email and ig_handle become
-- unique (case-insensitive). Both columns are nullable, so the unique indexes
-- are partial (WHERE ... is not null) to permit multiple NULLs.
--
-- NOTE: these CREATE UNIQUE INDEX statements will fail if the table already
-- contains case-insensitive duplicate emails or ig_handles. Detect duplicates
-- first with:
--   select lower(email) as email, count(*) from villagers
--   where email is not null group by lower(email) having count(*) > 1;
--   select lower(ig_handle) as ig_handle, count(*) from villagers
--   where ig_handle is not null group by lower(ig_handle) having count(*) > 1;

drop index if exists idx_villagers_display_name_unique;

create unique index if not exists idx_villagers_email_unique
  on villagers (lower(email)) where email is not null;

create unique index if not exists idx_villagers_ig_handle_unique
  on villagers (lower(ig_handle)) where ig_handle is not null;
