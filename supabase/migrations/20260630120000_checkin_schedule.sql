-- Check-in schedule (cron-driven open/close)
-- Incremental, idempotent migration for an existing database.
--
-- Holds a recurring weekly window that a scheduled job uses to flip
-- `checkins_enabled` on/off automatically. Shipped DISABLED so nothing changes
-- until an admin turns the schedule on; the manual check-ins toggle keeps
-- working either way.
--
-- Shape:
--   {
--     "enabled":  false,            -- when false, the cron no-ops (manual only)
--     "timezone": "America/New_York",
--     "open":  { "day": 1, "time": "17:00" },  -- day: 0=Sun..6=Sat
--     "close": { "day": 2, "time": "04:00" }   -- window may wrap past midnight
--   }
insert into studio_settings (key, value)
values (
  'checkin_schedule',
  '{"enabled":false,"timezone":"America/New_York","open":{"day":1,"time":"17:00"},"close":{"day":2,"time":"04:00"}}'::jsonb
)
on conflict (key) do nothing;
