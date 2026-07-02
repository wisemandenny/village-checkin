# Village Studio — Check-in & Payment System

Frictionless check-in and "pay what you can" system for an open recording studio.

## Architecture

```
village-checkin/
├── web/              # Next.js (App Router) — frontend + API
└── supabase/         # SQL schema migration
```

### Web App (`web/`)

- **Next.js** with App Router, React 19, Tailwind CSS
- Device-ID based auth via `localStorage` (no passwords)
- API routes for registration, check-in, Stripe Checkout fallback, webhooks

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase project (with Realtime enabled)
- Stripe account

### 1. Database Setup

Run `supabase/schema.sql` against your Supabase project via the SQL Editor.

### 2. Web App

```bash
cd web
cp .env.example .env.local    # Fill in your keys
npm install
npm run dev
```

## Environment Variables (Web)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_BASE_URL` | Public URL of the web app (production: `https://app.takesavillagemusic.com`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (browser) |
| `ADMIN_PASSWORD` | Fallback admin password (if not set in DB) |
| `CRON_SECRET` | Shared bearer secret for the scheduled check-in reconciler (`/api/cron/checkins`). Must match the `CRON_SECRET` GitHub Actions secret. If unset, the schedule is never enforced (the manual check-ins toggle still works). |
| `STRIPE_SUPPORTER_PRODUCT_ID` | (Recommended) Stripe Product id for recurring support. If unset, one is created on demand. |
| `R2_SELFIE_BUCKET` | Private Cloudflare R2 bucket for villager selfies shown on the "who's here" board. Served back through the app's `/api/selfie` route (no public bucket/domain). If unset, selfie capture is skipped (registration works as before). |
| `R2_ACCOUNT_ID` | Cloudflare account id — used to build the R2 S3 API endpoint. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token credentials scoped to Object Read & Write on the bucket (server only). |
| `KIT_API_KEY` | Kit (v4) API key — server only. Enables mailing-list + supporter sync. |
| `KIT_FORM_ID` | Kit Form id new subscribers are added to (triggers your welcome sequence). |
| `KIT_TAG_WEEKLY_ID` | Kit Tag id applied to active weekly supporters. |
| `KIT_TAG_MONTHLY_ID` | Kit Tag id applied to active monthly supporters. |
| `KIT_OAUTH_CLIENT_ID` / `KIT_OAUTH_CLIENT_SECRET` | (Optional) Kit OAuth app credentials. Required only for Kit purchase records; the `/v4/purchases` API rejects API-key auth. Without them, purchase tracking is skipped (tags + the subscriptions table remain the source of truth). |
| `KIT_OAUTH_SETUP_SECRET` | (Optional) Random string that gates the one-time `/api/kit/oauth/start` authorization route. |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key for transactional email — server only. Enables unpaid-check-in reminder emails. If unset, reminder sending is skipped. |
| `EMAIL_FROM` | Verified Resend sender for reminder emails, e.g. `The Village <hello@takesavillagemusic.com>`. |
| `PAY_TOKEN_SECRET` | Random string; HMAC secret for the signed pay links embedded in reminder emails. |
| `CRON_SECRET` | Random string the reminder cron must send as `Authorization: Bearer <secret>` when calling `/api/cron/payment-reminders`. |

### Unpaid check-in reminders

When a villager checks in but abandons the Stripe payment flow, their check-in
stays in status `pending` (`payment_method = 'deferred'`). A scheduled job emails
them a reminder **1 hour** and again **24 hours** after check-in, each containing a
signed one-tap link to `/pay/<token>` where they settle that specific visit
(routed through the normal payment intent + Stripe webhook, which flips the row to
`paid`). Each reminder is recorded on the check-in (`reminder_1h_sent_at`,
`reminder_24h_sent_at`) so it is never sent twice, and a 3-day safety window keeps
the first run after deploy from emailing a backlog of old pending rows.

- **Email:** [Resend](https://resend.com) — set `RESEND_API_KEY` + `EMAIL_FROM`.
- **Pay links:** signed with `PAY_TOKEN_SECRET` (HMAC, 7-day expiry).
- **Schedule:** the `.github/workflows/payment-reminders.yml` GitHub Action runs
  every 15 minutes and `POST`s to `/api/cron/payment-reminders` with the
  `CRON_SECRET` bearer token. Required **GitHub repo secrets**: `PROD_BASE_URL`,
  `CRON_SECRET` (and optionally `STAGING_BASE_URL`, `STAGING_CRON_SECRET`). The
  route is idempotent, so running it more or less often only changes timing.

### Kit integration

Stripe stays the payment processor; Kit mirrors mailing-list membership and
supporter tiers. If `KIT_API_KEY` is unset, all Kit syncing is skipped (the app
works exactly as before).

Setup in the Kit dashboard:

1. Create (or pick) the **Form** new villagers subscribe to → set `KIT_FORM_ID`.
2. Create two **Tags** (e.g. `supporter-weekly`, `supporter-monthly`) → set
   `KIT_TAG_WEEKLY_ID` / `KIT_TAG_MONTHLY_ID`.
3. Generate a **v4 API key** → set `KIT_API_KEY`.

Then, in the admin **Settings → Integrations** panel, click **Sync all
villagers to Kit** to backfill existing villagers (idempotent; safe to re-run).

Stripe webhook events used: `customer.subscription.created/updated/deleted`,
`invoice.paid`, `payment_intent.succeeded`, `checkout.session.completed`.

#### Kit purchase records (optional, OAuth)

Mailing-list sync and supporter tags work with just `KIT_API_KEY`. Kit's
`/v4/purchases` endpoint, however, requires **OAuth** and rejects API keys, so
logging each charge as a Kit purchase needs a one-time OAuth setup:

1. In Kit, create an **app** with OAuth enabled (Developer / App Store → Build →
   Authentication). Register the redirect URI
   `https://app.takesavillagemusic.com/api/kit/oauth/callback` (keep
   `https://village-checkin.vercel.app/api/kit/oauth/callback` until the legacy
   hostname redirect is live) and copy the **Client ID** + **Client Secret**.
2. Set `KIT_OAUTH_CLIENT_ID`, `KIT_OAUTH_CLIENT_SECRET`, and a random
   `KIT_OAUTH_SETUP_SECRET` in the environment, then deploy.
3. Visit `https://app.takesavillagemusic.com/api/kit/oauth/start?secret=YOUR_SETUP_SECRET`
   while logged into the Kit account and approve. Tokens are stored in
   `studio_settings` and auto-refreshed (refresh-token rotation handled), so no
   token ever needs to live in env.

If OAuth is not configured, purchase recording simply no-ops; tags and the
`subscriptions` table remain the source of truth for supporter status.

## Scheduled check-ins

Admins can toggle check-ins on/off manually in **Settings → Check-ins**, or hand
control to a weekly schedule in **Settings → Check-in schedule** (open day/time,
close day/time). Schedule times are Toronto (`America/Toronto`) local wall-clock
time; daylight saving is handled automatically. The schedule lives in
`studio_settings.checkin_schedule` and is enforced by a GitHub Actions cron
([.github/workflows/checkin-schedule.yml](.github/workflows/checkin-schedule.yml))
that runs every 15 minutes and calls `/api/cron/checkins` with the `CRON_SECRET`
bearer.

The route is **edge-triggered**: it only writes `checkins_enabled` when the
schedule crosses an open/close boundary, so a manual flip inside a window sticks
until the next boundary. When the schedule is disabled the cron no-ops and
check-ins stay under manual control. Set `CRON_SECRET` both as an app env var and
as a repository **Actions secret** of the same name.

## Payment Flow

1. User opens web app on phone → identifies via `localStorage` device ID
2. Chooses an amount → pays online
3. API creates a Stripe Checkout session → user completes payment on phone
4. Webhook updates the `check_ins` record to `paid`

### Recurring support (pay what you can)

- In the check-in payment step, users can switch to **Recurring** and set up a
  weekly (suggested $5) or monthly (suggested $15) Stripe subscription inline.
- The standalone **`/support`** page (linkable from the Kit newsletter) sets up
  the same via Stripe hosted Checkout.
- Active subscriptions are mirrored to the local `subscriptions` table and to
  Kit (a tier tag, plus a purchase record per charge when `KIT_OAUTH_TOKEN` is
  configured) by the Stripe webhook.
