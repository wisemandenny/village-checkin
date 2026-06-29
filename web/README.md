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

## First-of-the-month billing

Every recurring support subscription bills on the **first day of each month**.

Because the 1st is a fixed calendar day, Stripe's native monthly billing keeps each
cycle pinned to it forever — there is **no cron and no subscription-schedule
maintenance**.

### How it works

- **New supporters** (`src/app/api/create-subscription/route.ts`): the signup fee is
  charged immediately as a standalone **PaymentIntent** (confirmed inline with Stripe
  Elements, which also saves the card). Charging up front guarantees there is an
  invoice to confirm — a subscription whose first invoice is in the future produces
  none.
- On `payment_intent.succeeded` the **webhook** (`src/app/api/webhook/stripe/route.ts`)
  creates the subscription with `billing_cycle_anchor` set to the first of next month
  and `proration_behavior: "none"`, so the next charge lands on the 1st and every month
  after that bills on the 1st natively. Creation is idempotent per signup PaymentIntent.
- **Existing subscribers** are moved onto the 1st by a one-time migration
  (`scripts/migrate-to-first-of-month.ts`): it wraps each subscription in a short-lived
  Subscription Schedule (current period → first of next month, then an open-ended phase
  anchored to the 1st) with `end_behavior: "release"`, handing the subscription back to
  native monthly-on-the-1st billing. Re-running is safe (already-migrated subscriptions
  report `SKIP`).
- `src/lib/billing-anchor.ts` — shared UTC date math (`firstOfNextMonth`,
  `toUnixSeconds`) and the migration tag.

### Environment variables

- `STRIPE_SECRET_KEY` — used by the app and the migration script (test vs live is
  inferred from the key prefix).
- `STRIPE_WEBHOOK_SECRET` — verifies incoming Stripe webhooks (subscription creation
  depends on `payment_intent.succeeded` being delivered).

### Test-first workflow

Always validate against **test mode** before touching live data:

```bash
# 1. Verify both billing paths end-to-end against a Stripe test clock: a new
#    signup (immediate charge + monthly on the 1st) and an existing subscription
#    migrated onto the 1st. Asserts every recurring charge lands on the 1st.
STRIPE_SECRET_KEY=sk_test_... npm run verify:first-of-month

# 2. Migrate existing test-mode subscriptions onto the 1st.
STRIPE_SECRET_KEY=sk_test_... npm run migrate:first-of-month

# 3. Re-run; every subscription should report SKIP (idempotency).
STRIPE_SECRET_KEY=sk_test_... npm run migrate:first-of-month
```

### Pre-launch checks

- **Timezone**: all math is UTC, so "the 1st" is the 1st at 00:00 UTC. If billing must
  fall on the 1st in a local zone, adjust `firstOfNextMonth` in
  `src/lib/billing-anchor.ts` — that is the single place.
- **Near-term double charge**: a new supporter pays at signup and again on the next
  1st, which can be only days apart (e.g. signing up Jun 30 → next charge Jul 1). This
  is intentional.
- **Webhook reliability**: the subscription is created when `payment_intent.succeeded`
  is delivered. If that webhook fails, the signup fee is still collected but no
  subscription exists; re-running the migration does **not** recover it (there is no
  subscription yet) — retry via the admin "Refresh from Stripe" action or recreate it.
- **Non-active states**: the migration only touches `active` subscriptions. Decide
  whether `trialing` / `past_due` need inclusion.
