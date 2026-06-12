-- Studio Check-in & Payment System Schema

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Villagers table: one row per unique device
create table villagers (
  id          uuid primary key default gen_random_uuid(),
  device_id   text unique not null,
  display_name text not null,
  ig_handle    text,
  roles        text[] not null default '{}',
  instruments  text[] not null default '{}',
  email       text,
  marketing_opt_in boolean not null default true,
  test_account     boolean not null default false,
  stripe_customer_id text,
  kit_subscriber_id  text,
  -- Pokemon Infinite Fusion avatar: two IF Pokedex IDs (head + body), or NULL
  -- until the villager picks one on the "who's here" board.
  avatar_head smallint check (avatar_head between 1 and 1025),
  avatar_body smallint check (avatar_body between 1 and 1025),
  first_visited_at timestamptz not null default now(),
  last_visited_at  timestamptz
);

-- Check-ins table: one row per studio visit
create table check_ins (
  id                   uuid primary key default gen_random_uuid(),
  villager_id          uuid not null references villagers(id) on delete cascade,
  intent_amount        integer not null default 0,
  payment_method       text not null check (payment_method in ('terminal', 'online_fallback', 'cash', 'skipped', 'deferred')),
  status               text not null default 'pending' check (status in ('pending', 'paid', 'skipped')),
  created_at           timestamptz not null default now(),
  stripe_transaction_id text
);

-- Subscriptions table: recurring support pledges processed by Stripe.
-- Stripe remains the source of truth; this table is a history-capable mirror
-- written by the Stripe webhook (and reconcilable via the admin "Refresh from
-- Stripe" action). Mirrored into Kit as tags + purchase records.
create table subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  villager_id            uuid not null references villagers(id) on delete cascade,
  stripe_subscription_id text unique not null,
  status                 text not null,
  amount                 integer not null,
  interval               text not null check (interval in ('week', 'month')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Case-insensitive unique constraint on display_name for identity recovery
create unique index idx_villagers_display_name_unique
  on villagers (lower(display_name));

-- Index for fast lookups of a villager's subscriptions
create index idx_subscriptions_villager_id on subscriptions(villager_id);

-- Index for fast lookups by device_id
create index idx_villagers_device_id on villagers(device_id);

-- Index for fast lookups by villager
create index idx_check_ins_villager_id on check_ins(villager_id);

-- Row Level Security (RLS) policies
-- For now, keep it simple: service role has full access, anon can read/insert villagers
alter table villagers enable row level security;
alter table check_ins enable row level security;
-- subscriptions are only read/written via the service role (webhook + admin),
-- so RLS is enabled with no anon policies.
alter table subscriptions enable row level security;

-- Allow anon key to look up villagers by device_id
create policy "Villagers are viewable by anon"
  on villagers for select
  using (true);

create policy "Villagers can be inserted by anon"
  on villagers for insert
  with check (true);

create policy "Villagers can be updated by anon"
  on villagers for update
  using (true);

-- Check-ins: anon can insert and read their own
create policy "Check-ins are viewable by anon"
  on check_ins for select
  using (true);

create policy "Check-ins can be inserted by anon"
  on check_ins for insert
  with check (true);

create policy "Check-ins can be updated by service role"
  on check_ins for update
  using (true);

-- Deletes: only service role (admin) can delete; no anon delete policy needed
-- since the admin panel uses the service role key which bypasses RLS.

-- Studio settings: key-value store for feature flags and configuration
create table studio_settings (
  key   text primary key,
  value jsonb not null default 'false'::jsonb
);

insert into studio_settings (key, value) values ('payments_enabled', 'false');
insert into studio_settings (key, value) values ('admin_password', 'null');
-- Maintenance mode: when true, the whole site is locked down (only the admin
-- panel and Stripe webhooks stay reachable). OFF by default.
--
-- The flag is namespaced per environment (key 'maintenance_mode:<APP_ENV>',
-- e.g. 'maintenance_mode:production') because local dev shares production's
-- Supabase project — a single shared key would let local lock down prod. These
-- rows are created on demand the first time an admin toggles the setting, so we
-- intentionally do not seed them here.
-- Permanent allowlist of IG handles eligible for the exclusive ($10/month) tier.
insert into studio_settings (key, value) values ('exclusive_handles', '[]'::jsonb);

alter table studio_settings enable row level security;

create policy "Settings are viewable by anon"
  on studio_settings for select
  using (true);
