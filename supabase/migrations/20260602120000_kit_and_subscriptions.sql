-- Kit integration + recurring Stripe support
-- Incremental, idempotent migration for an existing database.
-- (schema.sql is the full fresh-install schema; this applies only the delta.)

-- 1. Track each villager's Kit subscriber id for efficient sync.
alter table villagers
  add column if not exists kit_subscriber_id text;

-- 2. Recurring support pledges processed by Stripe. Stripe is the source of
--    truth; this table is a history-capable mirror written by the Stripe
--    webhook (and reconcilable via the admin "Refresh from Stripe" action).
create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  villager_id            uuid not null references villagers(id) on delete cascade,
  stripe_subscription_id text unique not null,
  status                 text not null,
  amount                 integer not null,
  interval               text not null check (interval in ('week', 'month')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_subscriptions_villager_id
  on subscriptions(villager_id);

-- subscriptions are only read/written via the service role (webhook + admin),
-- so RLS is enabled with no anon policies.
alter table subscriptions enable row level security;
