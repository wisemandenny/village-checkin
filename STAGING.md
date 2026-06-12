# Staging environment runbook

A staging deploy of the web app that mirrors production but uses **isolated**
services so it never touches production data, takes live payments, or emails
real subscribers.

| Concern        | Production            | Staging                                  |
| -------------- | --------------------- | ---------------------------------------- |
| Vercel project | `village-checkin`     | `village-checkin-staging` (new)          |
| Deploy branch  | `main`                | `staging`                                |
| Domain         | (current prod domain) | `*.vercel.app` (free, assigned by Vercel)|
| Database       | Production Supabase   | Separate **staging** Supabase project    |
| Payments       | Stripe **live** mode  | Stripe **test** mode                     |
| Mailing list   | Production Kit        | Separate **staging** Kit account         |

Data flows one way only: a manual GitHub Action copies prod data **into**
staging. Staging never writes to any production service.

---

## 1. Create the `staging` branch

```bash
git checkout main && git pull
git checkout -b staging
git push -u origin staging
```

`main` keeps deploying to production; `staging` will deploy to the new project.

## 2. Create the staging Supabase project

1. In Supabase, create a new project (e.g. `village-checkin-staging`). Pick the
   same region as prod. Save the database password.
2. Open **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql)
   to create the tables, policies, and seed settings.
3. From **Settings → API**, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
4. From **Settings → Database → Connection string**, copy the **direct**
   connection URI (the session one, port `5432`, not the `6543` pooler). You'll
   use this for the seed Action as `STAGING_DATABASE_URL`. Append
   `?sslmode=require` if it isn't already present.

> Note the project's **Postgres major version** (Settings → Infrastructure).
> You'll match the seed Action's client to it in step 6.

## 3. Create the staging Stripe (test mode)

You don't need a new Stripe account — just use **Test mode** in your existing one.

1. Toggle the dashboard to **Test mode** (top-right).
2. **Developers → API keys**: copy the test **Secret key** (`sk_test_…`) →
   `STRIPE_SECRET_KEY`, and the test **Publishable key** (`pk_test_…`) →
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. (Optional) Create a test **Product** for recurring support and copy its id →
   `STRIPE_SUPPORTER_PRODUCT_ID`. If you skip this, one is created on demand.
4. The webhook is created **after** the Vercel project exists (step 5d) because
   it needs the staging URL.

## 4. Create the staging Kit account

You want Kit fully separated so staging never emails real people.

1. Sign up for a **separate Kit account** (or a separate workspace) for staging.
2. Create a **Form** new villagers subscribe to → its id is `KIT_FORM_ID`.
3. Create two **Tags** (e.g. `supporter-weekly`, `supporter-monthly`) →
   `KIT_TAG_WEEKLY_ID` / `KIT_TAG_MONTHLY_ID`.
4. Generate a **v4 API key** → `KIT_API_KEY`.
5. (Optional, only to test purchase records) Create a Kit **app** with OAuth,
   register the redirect URI `https://<staging-domain>/api/kit/oauth/callback`,
   and copy the Client ID/Secret → `KIT_OAUTH_CLIENT_ID` /
   `KIT_OAUTH_CLIENT_SECRET`. Pick any random `KIT_OAUTH_SETUP_SECRET`.

> To disable Kit on staging instead, just leave all `KIT_*` vars blank — the app
> skips Kit entirely.

## 5. Create the staging Vercel project

1. Vercel → **Add New… → Project** → import the **same** GitHub repo
   (`wisemandenny/village-checkin`). Name it `village-checkin-staging`.
2. **Root Directory:** set to `web` (same as production).
3. **Settings → Git → Production Branch:** set to `staging`. This makes pushes
   to `staging` the project's production deployment (stable URL, no preview
   login wall). Pushes to `main` here can be ignored.
4. **Settings → Environment Variables:** add every variable from
   [`web/.env.staging.example`](web/.env.staging.example) for the **Production**
   environment of *this* project, using the staging values from steps 2–4.
   - Use a **different `ADMIN_PASSWORD`** than production.
   - Set `NEXT_PUBLIC_BASE_URL` to the staging domain Vercel shows after the
     first deploy (e.g. `https://village-checkin-staging.vercel.app`), then
     redeploy so the value takes effect.
5. Trigger a deploy (push to `staging` or click **Deploy**). Note the assigned
   `*.vercel.app` URL.

### 5d. Stripe test webhook (needs the staging URL)

1. Stripe (Test mode) → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://<staging-domain>/api/webhook/stripe`.
3. Subscribe to: `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `payment_intent.succeeded`,
   `checkout.session.completed`.
4. Copy the endpoint's **Signing secret** (`whsec_…`) → set `STRIPE_WEBHOOK_SECRET`
   in the staging Vercel project and redeploy.

## 6. Seeding staging with production data (on demand)

This repo includes a **manual** GitHub Action,
[`.github/workflows/seed-staging-db.yml`](.github/workflows/seed-staging-db.yml),
that copies the app tables (`villagers`, `check_ins`, `subscriptions`,
`studio_settings`) from prod into staging as-is, replacing staging's current
rows.

One-time setup:

1. Add two **GitHub repository secrets** (Settings → Secrets and variables →
   Actions):
   - `PROD_DATABASE_URL` — direct connection URI for the **production**
     Supabase DB.
   - `STAGING_DATABASE_URL` — direct connection URI for the **staging** DB.
2. If your Supabase Postgres major version isn't 16, edit `PG_MAJOR` in the
   workflow to match (a `pg_dump` older than the server will fail).

To run it: GitHub → **Actions → "Seed staging DB from production" → Run
workflow** (on the default branch). The script refuses to run if the prod and
staging hosts are identical, as a safety guard.

> **PII / Stripe note:** data is copied as-is, so staging will contain real
> emails and IG handles, plus production Stripe **customer ids** that don't
> exist in test-mode Stripe (so charging a copied saved card on staging will
> fail — expected). Treat the staging DB with the same care as production.

You can also run the copy locally if you have the Postgres client installed:

```bash
PROD_DATABASE_URL='...' STAGING_DATABASE_URL='...' bash scripts/seed-staging-db.sh
```

## 7. Day-to-day workflow

- Merge/commit to `staging` → auto-deploys to the staging project.
- When happy, merge `staging` → `main` (PR) → auto-deploys to production.
- Refresh staging data anytime via the seed Action (step 6).

## Quick checklist

- [ ] `staging` branch pushed
- [ ] Staging Supabase project created + `schema.sql` applied
- [ ] Stripe test keys collected; webhook added after deploy
- [ ] Separate staging Kit account + keys (or left blank to disable)
- [ ] Staging Vercel project created, Root Dir `web`, Production Branch `staging`
- [ ] All `web/.env.staging.example` vars set in the staging project
- [ ] `PROD_DATABASE_URL` + `STAGING_DATABASE_URL` GitHub secrets added
- [ ] Seed Action run once to populate staging
