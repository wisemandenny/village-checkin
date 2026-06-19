-- Check-ins toggle
-- Incremental, idempotent migration for an existing database.
--
-- When false, visiting the site no longer records a check-in. Villagers can
-- still register, subscribe, and pay off a past unpaid session via the
-- "check-ins closed" landing page. ON by default so existing behavior (every
-- visit is a check-in) is preserved on deploy.
insert into studio_settings (key, value)
values ('checkins_enabled', 'true')
on conflict (key) do nothing;
