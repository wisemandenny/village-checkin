-- Moderator promotion: lets staff push standout uploads into the highlighted
-- mosaic tiles on the payment-confirmed screens. A nullable timestamp (rather
-- than a boolean) makes "newest-promoted wins" overflow ordering fall out for
-- free when more items are promoted than there are highlight slots.

alter table uploads add column if not exists promoted_at timestamptz;

create index if not exists idx_uploads_promoted on uploads (promoted_at desc)
  where deleted_at is null and not reported;
