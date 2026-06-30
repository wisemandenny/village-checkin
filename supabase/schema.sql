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
  -- When true, the villager is excluded from the "New Villagers This Week" stat.
  exclude_from_new boolean not null default false,
  stripe_customer_id text,
  kit_subscriber_id  text,
  -- Pokemon Infinite Fusion avatar: two IF Pokedex IDs (head + body), or NULL
  -- until the villager picks one on the "who's here" board.
  avatar_head smallint check (avatar_head between 1 and 1025),
  avatar_body smallint check (avatar_body between 1 and 1025),
  -- Selfie taken at first registration: app path (/api/selfie/<id>.<ext>) for a
  -- JPEG in a private Cloudflare R2 bucket, shown on the "who's here" board. NULL
  -- until taken; falls back to the fusion avatar.
  selfie_url text,
  first_visited_at timestamptz not null default now(),
  last_visited_at  timestamptz
);

-- Check-ins table: one row per studio visit
create table check_ins (
  id                   uuid primary key default gen_random_uuid(),
  villager_id          uuid not null references villagers(id) on delete cascade,
  intent_amount        integer not null default 0,
  payment_method       text not null check (payment_method in ('terminal', 'online_fallback', 'cash', 'skipped', 'deferred', 'subscription', 'elder')),
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
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Email and Instagram handle are unique (case-insensitive). Both columns are
-- nullable, so the unique indexes are partial to allow multiple NULLs.
-- Duplicate display_names are intentionally allowed.
create unique index idx_villagers_email_unique
  on villagers (lower(email)) where email is not null;

create unique index idx_villagers_ig_handle_unique
  on villagers (lower(ig_handle)) where ig_handle is not null;

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
-- Check-ins toggle: when false, visiting the site no longer records a check-in.
-- Villagers can still register, subscribe, and pay off a past unpaid session.
-- ON by default so the studio captures visits unless explicitly closed.
insert into studio_settings (key, value) values ('checkins_enabled', 'true');
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
-- Check-in schedule: a recurring weekly window a cron uses to flip
-- 'checkins_enabled' automatically. Shipped DISABLED so existing behavior is
-- unchanged until an admin turns it on; the manual toggle keeps working.
-- day: 0=Sun..6=Sat; the window may wrap past midnight. The companion
-- 'checkin_schedule_last_state' key is created on demand by the cron.
insert into studio_settings (key, value) values ('checkin_schedule', '{"enabled":false,"timezone":"America/New_York","open":{"day":1,"time":"17:00"},"close":{"day":2,"time":"04:00"}}'::jsonb);

alter table studio_settings enable row level security;

create policy "Settings are viewable by anon"
  on studio_settings for select
  using (true);

-- Community gallery uploads (photos and short videos in private R2 bucket).
create table uploads (
  id           uuid primary key default gen_random_uuid(),
  villager_id  uuid not null references villagers(id) on delete cascade,
  object_key   text not null,
  content_type text not null,
  kind         text not null check (kind in ('photo','video')),
  size_bytes   integer not null,
  reported     boolean not null default false,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text check (deleted_by in ('owner','admin'))
);

create index idx_uploads_created_at on uploads (created_at desc) where deleted_at is null;
create index idx_uploads_villager_created on uploads (villager_id, created_at desc);

alter table uploads enable row level security;
