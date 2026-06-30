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

-- Service role handles all reads/writes via API routes; no anon policies needed.
