-- Track subscriptions scheduled to cancel at the end of the billing period
-- Incremental, idempotent migration for an existing database.

-- A subscription cancelled via the app uses Stripe's cancel_at_period_end, so
-- it stays "active" (the member keeps access) until the period ends. Mirror
-- that flag locally so the admin panel can surface "ending" pledges distinctly.
alter table subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;
