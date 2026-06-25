-- Producer calendar booking system (issue #69)

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

-- Seed default rooms and time slots
insert into rooms (name, sort_order) values
  ('Studio A', 0),
  ('Studio B', 1);

insert into time_slots (label, start_time, end_time, sort_order) values
  ('Morning', '09:00', '12:00', 0),
  ('Afternoon', '13:00', '17:00', 1),
  ('Evening', '18:00', '21:00', 2);

-- Claim a slot with row-level locking so concurrent claims cannot oversell.
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

-- Cancel all confirmed bookings for slots on a given date (used when closing a day).
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
