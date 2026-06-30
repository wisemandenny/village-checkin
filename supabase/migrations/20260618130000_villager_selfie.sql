-- Villager selfie captured at first registration, shown on the "who's here" board.
-- Incremental, idempotent migration for an existing database.
--
-- Stores the app path (/api/selfie/<id>.<ext>) for a downscaled JPEG kept in a
-- private Cloudflare R2 bucket. NULL until the villager takes a selfie — existing
-- villagers and anyone who skips the camera stay NULL and fall back to their
-- fusion avatar.
alter table villagers
  add column if not exists selfie_url text;
