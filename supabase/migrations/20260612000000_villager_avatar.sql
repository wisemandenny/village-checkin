-- Villager avatars (Pokemon Infinite Fusion)
-- Incremental, idempotent migration for an existing database.
--
-- Each avatar is two Infinite Fusion Pokedex IDs (head + body); the fused
-- sprite is rendered from those. NULL means the villager has not picked yet.
-- The numeric bound is intentionally wide so the curated pool can grow over
-- time; the application validates submitted IDs against the curated pool.
alter table villagers
  add column if not exists avatar_head smallint check (avatar_head between 1 and 1025),
  add column if not exists avatar_body smallint check (avatar_body between 1 and 1025);
