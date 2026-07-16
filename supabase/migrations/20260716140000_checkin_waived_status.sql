-- Waived check-in status
-- Incremental, idempotent migration for an existing database.
--
-- Admins can waive a visit's fee (friends, industry, etc.). Those check-ins
-- are recorded with status 'waived' and intent_amount 0 — settled like 'paid'
-- for presence/unpaid flows, but distinct so revenue stats stay clean.

alter table check_ins drop constraint if exists check_ins_status_check;
alter table check_ins add constraint check_ins_status_check
  check (status in ('pending', 'paid', 'skipped', 'waived'));
