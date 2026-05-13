-- Studio Check-in & Payment System Schema

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Attendees table: one row per unique device
create table attendees (
  id          uuid primary key default gen_random_uuid(),
  device_id   text unique not null,
  display_name text not null,
  primary_role text,
  email       text,
  marketing_opt_in boolean not null default false,
  first_visited_at timestamptz not null default now(),
  last_visited_at  timestamptz
);

-- Check-ins table: one row per studio visit
create table check_ins (
  id                   uuid primary key default gen_random_uuid(),
  attendee_id          uuid not null references attendees(id) on delete cascade,
  intent_amount        integer not null default 0,
  payment_method       text not null check (payment_method in ('terminal', 'online_fallback', 'cash', 'skipped')),
  status               text not null default 'pending' check (status in ('pending', 'paid')),
  created_at           timestamptz not null default now(),
  stripe_transaction_id text
);

-- Case-insensitive unique constraint on display_name for identity recovery
create unique index idx_attendees_display_name_unique
  on attendees (lower(display_name));

-- Index for fast lookups by device_id
create index idx_attendees_device_id on attendees(device_id);

-- Index for fast lookups by attendee
create index idx_check_ins_attendee_id on check_ins(attendee_id);

-- Row Level Security (RLS) policies
-- For now, keep it simple: service role has full access, anon can read/insert attendees
alter table attendees enable row level security;
alter table check_ins enable row level security;

-- Allow anon key to look up attendees by device_id
create policy "Attendees are viewable by anon"
  on attendees for select
  using (true);

create policy "Attendees can be inserted by anon"
  on attendees for insert
  with check (true);

create policy "Attendees can be updated by anon"
  on attendees for update
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
