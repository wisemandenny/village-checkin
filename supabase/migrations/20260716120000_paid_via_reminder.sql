-- Track when a check-in was paid via the unpaid-reminder email pay link
-- (/pay/<token>). Method stays online_fallback; this flag is a secondary signal
-- for the admin check-ins UI.

alter table check_ins
  add column if not exists paid_via_reminder boolean not null default false;

-- Backfill: online payments that followed a sent reminder are the best proxy
-- for historical reminder-link settlements (pay tokens are not stored).
update check_ins
set paid_via_reminder = true
where status = 'paid'
  and payment_method = 'online_fallback'
  and (
    reminder_1h_sent_at is not null
    or reminder_24h_sent_at is not null
  );
