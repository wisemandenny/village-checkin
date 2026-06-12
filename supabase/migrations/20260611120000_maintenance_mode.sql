-- Maintenance mode toggle
-- Incremental, idempotent migration for an existing database.

-- When true, the whole site is locked down: every public page and API route is
-- blocked except the admin panel (and Stripe webhooks). OFF by default so the
-- migration is a no-op for live traffic until an admin enables it.
insert into studio_settings (key, value)
values ('maintenance_mode', 'false')
on conflict (key) do nothing;
