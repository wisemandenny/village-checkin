-- First-time free check-in status
-- Incremental, idempotent migration for an existing database.
--
-- A non-exclusive villager's first-ever check-in is free and bypasses payment.
-- That check-in is recorded with status 'first-time' so it is distinguishable in
-- admin from a normal 'skipped' (no payment requested) row.
--
-- The original schema created an unnamed column-level CHECK on check_ins.status,
-- which Postgres names 'check_ins_status_check'. Drop and re-add it to widen the
-- allowed set.
alter table check_ins drop constraint if exists check_ins_status_check;
alter table check_ins add constraint check_ins_status_check
  check (status in ('pending', 'paid', 'skipped', 'first-time'));
