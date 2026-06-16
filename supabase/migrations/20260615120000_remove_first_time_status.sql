-- Remove the "first time is free for non-exclusive members" feature.
-- Incremental, idempotent migration for an existing database.
--
-- The free first check-in was recorded with status 'first-time' and
-- payment_method 'skipped'. Those visits were on the house (no payment owed),
-- so reclassify them as plain 'skipped' rows before narrowing the CHECK
-- constraint back to the original allowed set.
update check_ins set status = 'skipped' where status = 'first-time';

alter table check_ins drop constraint if exists check_ins_status_check;
alter table check_ins add constraint check_ins_status_check
  check (status in ('pending', 'paid', 'skipped'));
