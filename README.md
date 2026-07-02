# Village Studio — Check-in & Payment System

The check-in and "pay what you can" app for **Potluck Sessions**, the Takes a
Village open recording studio. Villagers open the site on their phone, register
once, check in on arrival, and optionally pay whatever they can (one-time or as
a recurring supporter). Production runs at
[app.takesavillagemusic.com](https://app.takesavillagemusic.com).

There are no villager passwords — identity is tied to a device ID stored in the
browser. The admin dashboard is the only password-protected surface.

## Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org) (App Router, Turbopack), React 19, TypeScript
- **Styling:** Tailwind CSS v4
- **Database / realtime:** [Supabase](https://supabase.com) (Postgres) via `@supabase/supabase-js`
- **Payments:** [Stripe](https://stripe.com) — Elements (inline), hosted Checkout (fallback), Terminal (in-person), subscriptions, and webhooks
- **File storage:** [Cloudflare R2](https://developers.cloudflare.com/r2/) (private buckets) via the AWS S3 SDK + presigned URLs — villager selfies and community gallery uploads
- **Mailing list:** [Kit](https://kit.com) — membership + supporter-tier sync (optional)
- **Transactional email:** [Resend](https://resend.com) — unpaid check-in reminders (optional)
- **Charts:** Recharts (admin statistics)
- **Hosting:** Vercel, with scheduled jobs run by GitHub Actions crons

## Repository Layout

```
village-checkin/
├── web/                     # Next.js app (frontend + API routes) — the deployable
│   ├── src/app/             # App Router pages and /api routes
│   ├── src/components/      # UI (check-in flow, admin panels, gallery, etc.)
│   ├── src/lib/             # Stripe, Supabase, Kit, R2, billing, auth helpers
│   ├── scripts/             # Changelog generator + first-of-month billing tools
│   ├── .env.example         # Local env template
│   └── .env.staging.example # Staging env template
├── supabase/
│   ├── schema.sql           # Full Postgres schema (source of truth)
│   └── migrations/          # Timestamped, incremental migrations
├── scripts/                 # seed-staging-db.sh
├── .github/workflows/       # Cron + CI workflows
└── STAGING.md               # Staging environment runbook
```

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project (Postgres)
- A Stripe account (test mode is fine for local dev)
- Optional: Cloudflare R2, Kit, and Resend accounts to exercise selfies/gallery,
  mailing-list sync, and reminder emails

### 1. Database

Apply the schema to your Supabase project. Either run `supabase/schema.sql` in
the Supabase SQL Editor, or apply the incremental files in
`supabase/migrations/` in filename (timestamp) order. `schema.sql` is the
current source of truth; the migrations show how it evolved.

### 2. Web app

```bash
cd web
cp .env.example .env.local    # fill in your keys (see below)
npm install
npm run dev                   # http://localhost:3000
```

> Local dev shares the production Supabase project by default, so keep
> `APP_ENV=local` — this namespaces the maintenance-mode flag so local can't lock
> down production.

### Scripts (`web/`)

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (regenerates the changelog first via `predev`) |
| `npm run build` | Production build (regenerates the changelog first via `prebuild`) |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm run migrate:first-of-month` | One-time: move existing Stripe subscriptions onto 1st-of-month billing |
| `npm run verify:first-of-month` | Validate both billing paths against a Stripe test clock |

The changelog generator (`scripts/generate-changelog.mjs`) writes the last 100
git commits to `src/generated/changelog.json`, surfaced in the admin changelog
panel. It runs automatically before `dev` and `build`.

## Environment Variables

All variables live in `web/.env.local` (see `web/.env.example`). Many features
degrade gracefully — if the relevant keys are unset, that feature is simply
skipped and the core check-in flow keeps working.

### Core (required)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (browser) |
| `NEXT_PUBLIC_BASE_URL` | Public URL of the app (e.g. `http://localhost:3000`, prod `https://app.takesavillagemusic.com`) |
| `ADMIN_PASSWORD` | Admin dashboard password (fallback if not set in DB) |
| `APP_ENV` | Logical environment name (`local` / `staging` / `production`); namespaces maintenance mode |

### Optional / feature-gated

| Variable | Description |
|---|---|
| `STRIPE_SUPPORTER_PRODUCT_ID` | Stripe Product id for recurring support. If unset, one is created on demand |
| `CRON_SECRET` | Bearer secret shared with the GitHub Actions crons (`/api/cron/checkins`, `/api/cron/payment-reminders`). If unset, those routes are disabled |
| `R2_ACCOUNT_ID` | Cloudflare account id (builds the R2 S3 endpoint) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API credentials (Object Read & Write, server only) |
| `R2_SELFIE_BUCKET` | Private R2 bucket for villager selfies on the "who's here" board (served via `/api/selfie`). If unset, selfie capture is skipped |
| `R2_UPLOADS_BUCKET` | Private R2 bucket for community gallery uploads (direct browser upload via presigned URLs). If unset, the gallery is disabled |
| `UPLOAD_TOKEN_SECRET` | HMAC secret for short-lived gallery upload registration tokens |
| `KIT_API_KEY` | Kit (v4) API key — enables mailing-list + supporter-tier sync |
| `KIT_FORM_ID` | Kit Form new subscribers are added to (triggers the welcome sequence) |
| `KIT_TAG_WEEKLY_ID` / `KIT_TAG_MONTHLY_ID` | Kit Tag ids applied to active weekly/monthly supporters |
| `KIT_OAUTH_CLIENT_ID` / `KIT_OAUTH_CLIENT_SECRET` | Kit OAuth app credentials — required only for Kit purchase records (the `/v4/purchases` API rejects API-key auth) |
| `KIT_OAUTH_SETUP_SECRET` | Random string gating the one-time `/api/kit/oauth/start` route |
| `RESEND_API_KEY` | Resend API key for reminder emails. If unset, reminders are skipped |
| `EMAIL_FROM` | Verified Resend sender, e.g. `The Village <hello@takesavillagemusic.com>` |
| `PAY_TOKEN_SECRET` | HMAC secret for the signed pay links embedded in reminder emails |

## Features

### Check-in & pay-what-you-can

1. Villager opens the app on their phone and is identified by a `localStorage`
   device ID (registering the first time, checking in on return).
2. They choose an amount and pay inline with **Stripe Elements**, or fall back to
   Stripe **hosted Checkout** (`/api/checkout-fallback`). In-person card-reader
   payments are supported via **Stripe Terminal** routes.
3. The Stripe **webhook** (`/api/webhook/stripe`) flips the `check_ins` row to
   `paid`.

Villagers can skip payment; those visits stay `pending` and trigger reminders
(below).

### Recurring support (first-of-month billing)

- In the check-in payment step, villagers can switch to **Recurring** and set up
  a weekly or monthly Stripe subscription inline (`/api/create-subscription`).
- Every recurring subscription bills on the **1st of each month**. New signups
  pay their fee immediately as a PaymentIntent; the webhook then creates the
  subscription anchored to the 1st (native Stripe monthly billing — no cron).
  Existing subscriptions were moved onto the 1st by the one-time
  `migrate:first-of-month` script. See `web/README.md` for the full billing
  design and test-first workflow.
- Active subscriptions are mirrored to the local `subscriptions` table and to
  Kit. Villagers manage their subscription at **`/manage`**.

### Unpaid check-in reminders

When a villager checks in but abandons payment, the row stays `pending`
(`payment_method = 'deferred'`). A GitHub Actions cron (`payment-reminders.yml`,
every 15 min) `POST`s to `/api/cron/payment-reminders`, which emails a reminder
**1 hour** and again **24 hours** after check-in via Resend. Each email contains
a signed one-tap link to **`/pay/<token>`** (HMAC-signed with `PAY_TOKEN_SECRET`,
7-day expiry). Sends are recorded on the row (`reminder_1h_sent_at`,
`reminder_24h_sent_at`) so they never repeat, and a 3-day safety window prevents
emailing a backlog on first deploy.

### Scheduled check-ins

Admins toggle check-ins on/off manually in **Settings → Check-ins**, or hand
control to a weekly schedule (**Settings → Check-in schedule**) with open/close
day + time in Toronto (`America/Toronto`) wall-clock time (DST handled). The
schedule lives in `studio_settings.checkin_schedule` and is enforced by the
`checkin-schedule.yml` cron (every 15 min → `/api/cron/checkins`). The route is
**edge-triggered**: it only writes `checkins_enabled` when crossing an
open/close boundary, so a manual flip inside a window sticks until the next
boundary.

### "Who's here" board & community gallery

- **`/here`** shows who has checked in, each represented by a Pokémon Infinite
  Fusion avatar (proxied/cached through `/api/fusion-sprite`) or an optional
  selfie stored privately in R2 and served via `/api/selfie`.
- A community **gallery** lets villagers upload photos/videos directly to R2 via
  presigned URLs; it appears on the check-in and success screens.

### Admin dashboard (`/admin`)

Password-protected panels for villagers, check-ins, subscriptions, settings
(including Kit integration + maintenance mode), statistics (Recharts), the
community gallery, and the changelog.

### Kit mailing-list integration (optional)

Stripe stays the payment processor; Kit mirrors mailing-list membership and
supporter tiers. If `KIT_API_KEY` is unset, all Kit syncing is skipped.

1. Pick the **Form** villagers subscribe to → `KIT_FORM_ID`.
2. Create weekly/monthly **Tags** → `KIT_TAG_WEEKLY_ID` / `KIT_TAG_MONTHLY_ID`.
3. Generate a **v4 API key** → `KIT_API_KEY`.
4. In **Settings → Integrations**, click **Sync all villagers to Kit** to
   backfill (idempotent).

Logging each charge as a Kit **purchase** additionally requires OAuth (the
`/v4/purchases` endpoint rejects API keys): create a Kit app, register the
redirect URI `https://app.takesavillagemusic.com/api/kit/oauth/callback`, set
`KIT_OAUTH_CLIENT_ID` / `KIT_OAUTH_CLIENT_SECRET` / `KIT_OAUTH_SETUP_SECRET`,
deploy, then visit `/api/kit/oauth/start?secret=<KIT_OAUTH_SETUP_SECRET>` and
approve. Tokens are stored in `studio_settings` and auto-refreshed. Without
OAuth, purchase recording no-ops; tags + the `subscriptions` table remain the
source of truth.

## Deployment

The app deploys to **Vercel** from the `web/` directory. Production is served at
[app.takesavillagemusic.com](https://app.takesavillagemusic.com); the legacy
`village-checkin.vercel.app` host permanently redirects there (except
`/api/webhook/*`, so in-flight webhooks still reach the old host during
migration).

Set every environment variable above in the Vercel project. Point your Stripe
webhook endpoint at `<NEXT_PUBLIC_BASE_URL>/api/webhook/stripe`.

Scheduled jobs run as GitHub Actions crons (`.github/workflows/`) and call the
`/api/cron/*` routes with the `CRON_SECRET` bearer token. Set `CRON_SECRET` both
as an app env var **and** as a repository **Actions secret** of the same name.
Relevant repo secrets: `PROD_BASE_URL`, `CRON_SECRET` (and, for staging,
`STAGING_BASE_URL`, `STAGING_CRON_SECRET`). Because the cron routes are
idempotent, running them more or less often only changes timing.

### Staging

A separate Vercel + Supabase + Stripe (test-mode) stack keeps staging fully
isolated from production data, live payments, and the real mailing list. Use
`web/.env.staging.example` as the template and follow **[STAGING.md](STAGING.md)**
for the full runbook.
