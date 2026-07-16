-- Studio Check-in & Payment System Schema

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Villagers table: one row per villager. A villager can sign in from multiple
-- devices, so device_ids holds every device that resolves to this account.
create table villagers (
  id          uuid primary key default gen_random_uuid(),
  device_ids  text[] not null default '{}',
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
  stripe_transaction_id text,
  -- Set when the unpaid-check-in reminder emails are sent (1h and 24h after a
  -- 'pending' check-in), so the scheduled job never sends the same nudge twice.
  reminder_1h_sent_at  timestamptz,
  reminder_24h_sent_at timestamptz
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

-- GIN index for fast containment lookups by device_id (device_ids @> '{<id>}').
create index idx_villagers_device_ids on villagers using gin (device_ids);

-- Global uniqueness: no device id may belong to two villagers. Postgres
-- exclusion constraints don't support GIN, so a trigger enforces it instead.
-- Raised with errcode unique_violation (23505) so the app maps it to the
-- existing "Device already registered" message.
create or replace function villagers_device_ids_unique()
returns trigger as $$
begin
  if new.device_ids is not null and array_length(new.device_ids, 1) is not null then
    if exists (
      select 1 from villagers v
      where v.id <> new.id and v.device_ids && new.device_ids
    ) then
      raise exception 'device_id already registered to another villager'
        using errcode = 'unique_violation';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_villagers_device_ids_unique
  before insert or update of device_ids on villagers
  for each row execute function villagers_device_ids_unique();

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
-- Times are Toronto (America/Toronto) local wall-clock; DST is handled by the
-- app, so no timezone is stored. day: 0=Sun..6=Sat; the window may wrap past
-- midnight. The companion 'checkin_schedule_last_state' key is created on
-- demand by the cron.
insert into studio_settings (key, value) values ('checkin_schedule', '{"enabled":false,"open":{"day":1,"time":"17:00"},"close":{"day":2,"time":"04:00"}}'::jsonb);

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

-- Producer calendar booking (issue #69)

create table rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  active      boolean not null default true,
  sort_order  integer not null default 0
);

create table time_slots (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  start_time  time not null,
  end_time    time not null,
  active      boolean not null default true,
  sort_order  integer not null default 0
);

create table booking_slots (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  room_id       uuid not null references rooms(id) on delete cascade,
  time_slot_id  uuid not null references time_slots(id) on delete cascade,
  capacity      integer not null default 1 check (capacity > 0),
  status        text not null default 'open' check (status in ('open', 'closed')),
  created_at    timestamptz not null default now(),
  unique (date, room_id, time_slot_id)
);

create table bookings (
  id                       uuid primary key default gen_random_uuid(),
  booking_slot_id          uuid not null references booking_slots(id) on delete cascade,
  villager_id              uuid not null references villagers(id) on delete cascade,
  status                   text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at               timestamptz not null default now(),
  cancelled_at             timestamptz,
  reminder_sent_at         timestamptz,
  amount_cents             integer,
  payment_status           text,
  stripe_payment_intent_id text,
  unique (booking_slot_id, villager_id)
);

create table booking_invites (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  token        text unique not null,
  villager_id  uuid references villagers(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'expired')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  created_by   text
);

create index idx_booking_slots_date on booking_slots(date);
create index idx_bookings_slot_status on bookings(booking_slot_id, status);
create index idx_bookings_villager on bookings(villager_id, status);
create index idx_booking_invites_token on booking_invites(token);
create index idx_booking_invites_email on booking_invites(lower(email));

alter table rooms enable row level security;
alter table time_slots enable row level security;
alter table booking_slots enable row level security;
alter table bookings enable row level security;
alter table booking_invites enable row level security;

insert into rooms (name, sort_order) values
  ('Studio A', 0),
  ('Studio B', 1);

insert into time_slots (label, start_time, end_time, sort_order) values
  ('Morning', '09:00', '12:00', 0),
  ('Afternoon', '13:00', '17:00', 1),
  ('Evening', '18:00', '21:00', 2);

create or replace function claim_booking_slot(
  p_booking_slot_id uuid,
  p_villager_id uuid
) returns uuid
language plpgsql
as $$
declare
  v_slot booking_slots%rowtype;
  v_count integer;
  v_booking_id uuid;
begin
  select * into v_slot
  from booking_slots
  where id = p_booking_slot_id
  for update;

  if not found then
    raise exception 'SLOT_NOT_FOUND';
  end if;

  if v_slot.status <> 'open' then
    raise exception 'SLOT_CLOSED';
  end if;

  select count(*)::integer into v_count
  from bookings
  where booking_slot_id = p_booking_slot_id
    and status = 'confirmed';

  if v_count >= v_slot.capacity then
    raise exception 'SLOT_FULL';
  end if;

  if exists (
    select 1 from bookings
    where booking_slot_id = p_booking_slot_id
      and villager_id = p_villager_id
      and status = 'confirmed'
  ) then
    raise exception 'ALREADY_BOOKED';
  end if;

  insert into bookings (booking_slot_id, villager_id, status)
  values (p_booking_slot_id, p_villager_id, 'confirmed')
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

create or replace function cancel_bookings_for_date(p_date date)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  update bookings b
  set status = 'cancelled', cancelled_at = now()
  from booking_slots bs
  where b.booking_slot_id = bs.id
    and bs.date = p_date
    and b.status = 'confirmed';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
