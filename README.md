# Village Studio — Check-in & Payment System

Frictionless check-in and "pay what you can" system for an open recording studio.

## Architecture

```
village-checkin/
├── web/              # Next.js (App Router) — frontend + API
├── tablet-kiosk/     # React Native (Expo) — front desk kiosk
└── supabase/         # SQL schema migration
```

### Web App (`web/`)

- **Next.js** with App Router, React 19, Tailwind CSS
- Device-ID based auth via `localStorage` (no passwords)
- API routes for registration, check-in, Stripe Checkout fallback, webhooks
- Supabase Realtime broadcast to trigger payments on the tablet

### Tablet Kiosk (`tablet-kiosk/`)

- **Expo / React Native** targeting Samsung Galaxy Tab Active3
- Supabase Realtime subscriber — receives payment requests from web clients
- Stripe Terminal SDK for physical card tap-to-pay

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase project (with Realtime enabled)
- Stripe account (with Terminal enabled for physical payments)

### 1. Database Setup

Run `supabase/schema.sql` against your Supabase project via the SQL Editor.

### 2. Web App

```bash
cd web
cp .env.example .env.local    # Fill in your keys
npm install
npm run dev
```

### 3. Tablet Kiosk

```bash
cd tablet-kiosk
# Edit src/config.ts with your Supabase + API URLs
npm install
npx expo start
```

## Environment Variables (Web)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_BASE_URL` | Public URL of the web app |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (browser) |
| `ADMIN_PASSWORD` | Fallback admin password (if not set in DB) |
| `STRIPE_SUPPORTER_PRODUCT_ID` | (Recommended) Stripe Product id for recurring support. If unset, one is created on demand. |
| `KIT_API_KEY` | Kit (v4) API key — server only. Enables mailing-list + supporter sync. |
| `KIT_FORM_ID` | Kit Form id new subscribers are added to (triggers your welcome sequence). |
| `KIT_TAG_WEEKLY_ID` | Kit Tag id applied to active weekly supporters. |
| `KIT_TAG_MONTHLY_ID` | Kit Tag id applied to active monthly supporters. |
| `KIT_OAUTH_CLIENT_ID` / `KIT_OAUTH_CLIENT_SECRET` | (Optional) Kit OAuth app credentials. Required only for Kit purchase records; the `/v4/purchases` API rejects API-key auth. Without them, purchase tracking is skipped (tags + the subscriptions table remain the source of truth). |
| `KIT_OAUTH_SETUP_SECRET` | (Optional) Random string that gates the one-time `/api/kit/oauth/start` authorization route. |

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
   Authentication). Register the redirect URI `https://YOUR-DOMAIN/api/kit/oauth/callback`
   and copy the **Client ID** + **Client Secret**.
2. Set `KIT_OAUTH_CLIENT_ID`, `KIT_OAUTH_CLIENT_SECRET`, and a random
   `KIT_OAUTH_SETUP_SECRET` in the environment, then deploy.
3. Visit `https://YOUR-DOMAIN/api/kit/oauth/start?secret=YOUR_SETUP_SECRET`
   while logged into the Kit account and approve. Tokens are stored in
   `studio_settings` and auto-refreshed (refresh-token rotation handled), so no
   token ever needs to live in env.

If OAuth is not configured, purchase recording simply no-ops; tags and the
`subscriptions` table remain the source of truth for supporter status.

## Payment Flow

1. User opens web app on phone → identifies via `localStorage` device ID
2. Chooses an amount → selects "Tap at Front Desk" or "Pay Online"
3. **Terminal path:** API broadcasts payment request via Supabase Realtime → tablet receives it → initiates Stripe Terminal charge → user taps card
4. **Online path:** API creates Stripe Checkout session → user completes payment on phone
5. Webhook/tablet updates `check_ins` record to `paid`

### Recurring support (pay what you can)

- In the check-in payment step, users can switch to **Recurring** and set up a
  weekly (suggested $5) or monthly (suggested $15) Stripe subscription inline.
- The standalone **`/support`** page (linkable from the Kit newsletter) sets up
  the same via Stripe hosted Checkout.
- Active subscriptions are mirrored to the local `subscriptions` table and to
  Kit (a tier tag, plus a purchase record per charge when `KIT_OAUTH_TOKEN` is
  configured) by the Stripe webhook.
