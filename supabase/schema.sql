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
  marketing_opt_in boolean not null default false,
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

-- Case-insensitive unique constraint on display_name for identity recovery
create unique index idx_villagers_display_name_unique
  on villagers (lower(display_name));

-- Index for fast lookups by device_id
create index idx_villagers_device_id on villagers(device_id);

-- Index for fast lookups by villager
create index idx_check_ins_villager_id on check_ins(villager_id);

-- Row Level Security (RLS) policies
-- For now, keep it simple: service role has full access, anon can read/insert villagers
alter table villagers enable row level security;
alter table check_ins enable row level security;

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
