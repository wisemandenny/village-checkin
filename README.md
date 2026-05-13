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

## Payment Flow

1. User opens web app on phone → identifies via `localStorage` device ID
2. Chooses an amount → selects "Tap at Front Desk" or "Pay Online"
3. **Terminal path:** API broadcasts payment request via Supabase Realtime → tablet receives it → initiates Stripe Terminal charge → user taps card
4. **Online path:** API creates Stripe Checkout session → user completes payment on phone
5. Webhook/tablet updates `check_ins` record to `paid`
