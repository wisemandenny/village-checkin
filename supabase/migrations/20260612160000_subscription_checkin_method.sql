-- Subscription-paid check-ins
-- Incremental, idempotent migration for an existing database.

-- Allow check-ins to be recorded as paid via an active recurring subscription.
-- Villagers with an active subscription are recorded with payment_method
-- 'subscription' (status 'paid') at check-in instead of the default 'skipped'.
alter table check_ins drop constraint check_ins_payment_method_check;
alter table check_ins add constraint check_ins_payment_method_check
  check (payment_method in ('terminal', 'online_fallback', 'cash', 'skipped', 'deferred', 'subscription'));
