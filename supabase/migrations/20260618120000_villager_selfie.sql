-- Villager selfie captured at first registration, shown on the "who's here" board.
-- Incremental, idempotent migration for an existing database.
--
-- Stored as the public URL of a downscaled JPEG uploaded to Cloudflare R2. NULL
-- until the villager takes a selfie — existing villagers and anyone who skips the
-- camera stay NULL and fall back to their fusion avatar.
alter table villagers
  add column if not exists selfie_url text;
