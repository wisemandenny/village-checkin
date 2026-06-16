-- Allow admins to flag a villager so they no longer count toward the
-- "New Villagers This Week" stat. Incremental, idempotent migration.
alter table villagers
  add column if not exists exclude_from_new boolean not null default false;
