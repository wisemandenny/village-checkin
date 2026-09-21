-- Contributions ledger + redefine total_contributed to sum it.
-- Safe to run after 20260716130000 (which only created the old check_ins-based
-- function). No need to roll that migration back — CREATE OR REPLACE updates it.
create table if not exists contributions (
  id                     uuid primary key default gen_random_uuid(),
  villager_id            uuid not null references villagers(id) on delete cascade,
  amount_cents           integer not null check (amount_cents > 0),
  source                 text not null check (source in (
    'check_in',
    'subscription_signup',
    'subscription_invoice',
    'admin'
  )),
  -- At most one contribution per check-in / Stripe txn (NULLs allowed multiple times).
  check_in_id            uuid unique references check_ins(id) on delete set null,
  stripe_transaction_id  text unique,
  created_at             timestamptz not null default now()
);

create index if not exists idx_contributions_villager_id
  on contributions (villager_id);

alter table contributions enable row level security;

-- Backfill from paid check-ins that carried a real amount. Subscription/elder
-- visits are recorded as paid with $0 (covered / exempt) and are excluded.
insert into contributions (
  villager_id,
  amount_cents,
  source,
  check_in_id,
  stripe_transaction_id,
  created_at
)
select
  c.villager_id,
  c.intent_amount,
  case
    when c.payment_method = 'cash' then 'check_in'
    when c.stripe_transaction_id like 'in_%' then 'subscription_invoice'
    when c.stripe_transaction_id like 'pi_%'
         and c.payment_method in ('online_fallback', 'terminal', 'deferred')
      then 'check_in'
    else 'check_in'
  end,
  c.id,
  nullif(c.stripe_transaction_id, ''),
  c.created_at
from check_ins c
where c.status = 'paid'
  and c.intent_amount > 0
  and c.payment_method not in ('subscription', 'elder')
on conflict do nothing;

create or replace function total_contributed(villagers)
returns integer
language sql
stable
parallel safe
as $$
  select coalesce(sum(c.amount_cents), 0)::integer
  from contributions c
  where c.villager_id = $1.id;
$$;
