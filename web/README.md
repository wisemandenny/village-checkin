This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## First-Monday-of-the-month billing

Existing active Stripe subscriptions are migrated to bill on the **first Monday of each month**, regardless of original signup date.

> **Scope:** this covers the one-time migration of existing `active` subscriptions plus ongoing maintenance of those schedules. Enrolling brand-new signups at creation time and handling `trialing` / `past_due` subscriptions are intentionally out of scope here (see Pre-launch checks) — re-running the migration also picks up any new `active` subscriptions.

Stripe's `billing_cycle_anchor` can only lock a fixed calendar day, but the first Monday shifts between the 1st and 7th, so it cannot be tracked natively. Instead each subscription is wrapped in a **Subscription Schedule** whose phase boundaries land on a computed first-Monday date, and a **monthly Vercel Cron** keeps every schedule extended one phase ahead so billing never drifts back to same-day-next-month.

### Pieces

- `src/lib/first-monday.ts` — shared UTC date math (`getFirstMondayOfMonth`, `nextFirstMondayAnchor`, `toUnixSeconds`).
- `scripts/migrate-to-first-monday.ts` — one-time, idempotent migration that wraps every active subscription in a schedule anchored to the next first Monday.
- `src/app/api/cron/extend-schedules/route.ts` — `GET` cron endpoint that appends the next first-Monday phase to each tagged schedule. Idempotent and auth-protected.
- `vercel.json` — schedules the cron daily on the 2nd–8th (06:00 UTC) as a safety margin. The endpoint is idempotent, so repeated days never double-charge.

### Environment variables

- `STRIPE_SECRET_KEY` — used by both the migration script and the cron (test vs live is inferred from the key prefix).
- `CRON_SECRET` — long random string set in Vercel project settings. Vercel sends it to the cron as `Authorization: Bearer <CRON_SECRET>`; the endpoint returns `401` without it.

### Test-first workflow

Always validate against **test mode** before touching live data:

```bash
# 1. Run the migration against test-mode subscriptions
STRIPE_SECRET_KEY=sk_test_... npm run migrate:first-monday

# 2. Inspect the resulting schedules in the Stripe Dashboard
#    (Billing → Subscription schedules): confirm the phase boundary lands on the
#    correct first Monday and that items/quantities carried over.

# 3. Re-run; every subscription should report SKIP (idempotency)
STRIPE_SECRET_KEY=sk_test_... npm run migrate:first-monday

# 4. Exercise the cron locally (with the dev server running)
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/extend-schedules
# Invoke again immediately → extendedCount should be 0 (nothing double-extended).
# Invoke with a wrong/missing token → 401.
```

### Pre-launch checks

- **Timezone**: all math is UTC. If "first Monday" must be local (e.g. `America/Toronto`), adjust `getFirstMondayOfMonth` in `src/lib/first-monday.ts` — that is the single place.
- **Proration**: the migration's stub period defaults to `proration_behavior: "none"` (no charge for the partial period before the first new cycle). Confirm this is desired before going live.
- **Webhooks**: schedule-managed subscriptions still emit `customer.subscription.updated` / invoice events, plus `subscription_schedule.*` events. Verify existing handlers behave.
- **Alerting**: the cron returns an `errors` array — wire a failure alert so a silently failing cron (which would let subscriptions drift) gets noticed.
- **Non-active states**: the migration only touches `active` subscriptions. Decide whether `trialing` / `past_due` need inclusion.
