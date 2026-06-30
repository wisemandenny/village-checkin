-- Unpaid check-in payment reminders
-- Incremental, idempotent migration for an existing database.

-- Villagers who check in but abandon the Stripe payment flow leave a check-in
-- stuck in status 'pending'. A scheduled job emails them a reminder after 1 hour
-- and again after 24 hours. These columns record when each reminder was sent so
-- the job never sends the same nudge twice.
alter table check_ins add column if not exists reminder_1h_sent_at  timestamptz;
alter table check_ins add column if not exists reminder_24h_sent_at timestamptz;
