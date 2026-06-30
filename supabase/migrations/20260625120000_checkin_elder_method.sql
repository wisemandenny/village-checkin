-- Elder-exempt check-ins
-- Incremental, idempotent migration for an existing database.

-- The Elder role permanently exempts a member from payment. At check-in those
-- visits are recorded with payment_method 'elder' (status 'paid'), but the
-- payment_method check constraint was never widened to allow it — so Elder
-- check-ins failed with a constraint violation whenever check-ins were open.
-- Add 'elder' to the allowed set.
alter table check_ins drop constraint check_ins_payment_method_check;
alter table check_ins add constraint check_ins_payment_method_check
  check (payment_method in ('terminal', 'online_fallback', 'cash', 'skipped', 'deferred', 'subscription', 'elder'));
