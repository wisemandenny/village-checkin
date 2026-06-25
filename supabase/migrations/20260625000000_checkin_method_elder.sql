-- Elder-exempt check-ins
-- Incremental, idempotent migration for an existing database.

-- Allow check-ins to be recorded as paid via the elder role exemption.
-- Villagers with the elder role are recorded with payment_method 'elder'
-- (status 'paid') at check-in instead of prompting for payment.
alter table check_ins drop constraint check_ins_payment_method_check;
alter table check_ins add constraint check_ins_payment_method_check
  check (payment_method in ('terminal', 'online_fallback', 'cash', 'skipped', 'deferred', 'subscription', 'elder'));
