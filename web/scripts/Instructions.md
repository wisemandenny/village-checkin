# bill-now-and-anchor — Run Instructions

One-time script to immediately charge all active subscribers for the current month and move every subscription onto 1st-of-the-month billing going forward.

## What it does

For each active Stripe subscription:

1. **Bills immediately** — creates an invoice for the full monthly amount and charges the subscriber's saved payment method right now.
2. **Anchors to the 1st** — sets `trial_end` to August 1 (noon UTC = 8 AM EDT), which:
   - Suppresses any intermediate renewal invoices between now and August 1
   - Permanently sets the billing cycle anchor to August 1 when the trial ends, so subsequent months land on September 1, October 1, etc. automatically

## Prerequisites

- A Stripe secret key (test or live) with permission to read/write subscriptions, invoices, and invoice items.
- Every subscriber must have a saved `default_payment_method` on their subscription or customer object. The script will log `FAIL` and skip a subscriber if none is found.

## Running

**Always run against test mode first.**

```bash
cd web

# Test mode
STRIPE_SECRET_KEY=sk_test_... npm run bill:now-and-anchor

# Live mode (only after verifying test output)
STRIPE_SECRET_KEY=sk_live_... npm run bill:now-and-anchor
```

Alternatively, set `STRIPE_SECRET_KEY` in `web/.env.local` and run without the inline variable.

## Output

```
[bill-now] LIVE mode | anchor=2026-08-01T12:00:00.000Z
[bill-now] BILLED      sub_xxx (customer@example.com)
[bill-now] ANCHOR_ONLY sub_yyy (other@example.com)   ← already invoiced, anchor only
[bill-now] SKIP        sub_zzz (third@example.com)   ← fully done, skipped
[bill-now] FAIL        sub_aaa (bad@example.com): no default_payment_method ...
[bill-now] done — billed=N anchorOnly=N skipped=N failed=N
```

## Idempotency — safe to re-run

The script uses two metadata tags on each subscription to track progress independently:

| Tag | Set after | Effect on re-run |
|---|---|---|
| `billing_jul2026_invoiced` | invoice paid | skips billing, still applies anchor |
| `billing_jul2026_fixed` | both steps done | skips subscription entirely |

If the script is interrupted (e.g. a `FAIL` on the anchor step after billing succeeds), re-running will skip the invoice and only retry the anchor — no double charges.

## After running

- Subscription status changes to **trialing** until August 1. This is expected — the app treats `trialing` the same as `active`.
- On August 1, Stripe charges each subscriber automatically and status returns to **active**.
- Check the Stripe dashboard: each processed subscription should show next invoice date = August 1 with no intermediate invoices.
