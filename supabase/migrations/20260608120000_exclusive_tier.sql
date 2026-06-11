-- Exclusive support tier
-- Incremental, idempotent migration for an existing database.

-- Permanent allowlist of IG handles eligible for the exclusive ($10/month)
-- tier. Handles are stored normalized (lowercase, "@"-prefixed). Matching
-- registered villagers receive the "exclusive" role in villagers.roles; any
-- not-yet-registered handles are granted the role on registration/recovery.
insert into studio_settings (key, value)
values ('exclusive_handles', '[]'::jsonb)
on conflict (key) do nothing;
