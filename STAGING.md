# Staging environment runbook

A staging deploy of the web app that mirrors production but uses **isolated**
services so it never touches production data, takes live payments, or emails
real subscribers.

| Concern        | Production            | Staging                                  |
| -------------- | --------------------- | ---------------------------------------- |
| Vercel project | `village-checkin`     | `village-checkin-staging` (new)          |
| Deploy branch  | `main`                | `staging`                                |
| Domain         | `app.takesavillagemusic.com` | `village-checkin-beta.vercel.app` (free, assigned by Vercel)|
| Database       | Production Supabase   | Separate **staging** Supabase project    |
| Payments       | Stripe **live** mode  | Stripe **test** mode                     |
| Mailing list   | Production Kit        | Separate **staging** Kit account         |

Data flows one way only: a manual GitHub Action copies prod data **into**
staging. Staging never writes to any production service.

---
commit

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
4. From **Settings → Database → Connection string**, switch the dropdown to
   **"Session pooler"** and copy that URI — you'll use it for the seed Action as
   `STAGING_DATABASE_URL`. See the connection-string notes in step 6 before
   filling in the password.

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

You need the staging domain first (the `*.vercel.app` URL from step 5, i.e. the
value in `NEXT_PUBLIC_BASE_URL`). Test mode and live mode have **separate**
webhooks and signing secrets, so make sure you're in test mode throughout.

1. In Stripe, confirm **Test mode** is on (top-right toggle; the URL reads
   `dashboard.stripe.com/test/...`).
2. Open **Developers → Webhooks** (newer accounts: **Developers → Workbench →
   Webhooks** tab). Direct link: <https://dashboard.stripe.com/test/webhooks>.
3. Click **+ Add endpoint** ("Add an endpoint" / "Add destination").
4. **Endpoint URL:** `https://<staging-domain>/api/webhook/stripe`
   (e.g. `https://village-checkin-staging.vercel.app/api/webhook/stripe`).
5. Leave "Listen to events on your account" selected.
6. Click **Select events** and add these six (search each by name and check it):
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `payment_intent.succeeded`
   - `checkout.session.completed`
7. Click **Add events**, then **Add endpoint** to save.
8. On the endpoint's detail page, find **Signing secret** → click **Reveal** →
   copy the value (`whsec_…`). This is `STRIPE_WEBHOOK_SECRET`.
9. Set it in **both** places, then redeploy the staging project:
   - local `web/.env.staging`
   - the staging Vercel project's Environment Variables (Production scope)
10. (Optional) Verify with **Send test webhook** → `payment_intent.succeeded` →
    confirm a `200` response from the staging URL.

## 6. Seeding staging with production data (on demand)

This repo includes a **manual** GitHub Action,
[`.github/workflows/seed-staging-db.yml`](.github/workflows/seed-staging-db.yml),
that copies the app tables (`villagers`, `check_ins`, `subscriptions`,
`studio_settings`) from prod into staging as-is, replacing staging's current
rows.

One-time setup:

1. Add two **GitHub repository secrets** (Settings → Secrets and variables →
   Actions):
   - `PROD_DATABASE_URL` — connection string for the **production** Supabase DB.
   - `STAGING_DATABASE_URL` — connection string for the **staging** DB.

   **Use the "Session pooler" connection string**, not the direct one. In each
   Supabase project, go to **Settings → Database → Connection string**, switch
   the dropdown to **Session pooler**, and copy it. It looks like:

   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

   Why the pooler: the **direct** host (`db.<ref>.supabase.co`) is IPv6-only
   unless you've added Supabase's IPv4 add-on, and GitHub Actions runners are
   IPv4 — so a direct URL fails to connect. The session pooler is IPv4-friendly
   and supports `pg_dump`.

   Filling in the password:
   - Replace the **entire** `[YOUR-PASSWORD]` placeholder (brackets included)
     with your **database password** — the one set when the project was created
     (reset it under **Settings → Database → Reset database password** if you
     don't have it). This is *not* your Supabase login or the API keys.
   - If the password has URL-special characters (`@ : / ? # [ ] %`),
     URL-encode them (`@`→`%40`, `#`→`%23`, …). Easiest is to reset it to a long
     alphanumeric password so no encoding is needed.
2. The workflow installs `pg_dump`/`psql` for `PG_MAJOR` (default `17`). If your
   Supabase Postgres major version differs (see Settings → Infrastructure), edit
   `PG_MAJOR` in the workflow to match — a `pg_dump` older than the server fails.

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

## 8. Gallery uploads (R2)

The `/gallery` feature stores photos and short videos in a **separate private R2
bucket** (`R2_UPLOADS_BUCKET`), distinct from the selfie bucket. Set these env
vars on the staging Vercel project:

- `R2_UPLOADS_BUCKET` — name of the private uploads bucket (create one per env).
- `UPLOAD_TOKEN_SECRET` — random string used to sign short-lived upload tokens.
- Reuse the same `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`
  as selfies (or dedicated keys scoped to both buckets).

Apply the `uploads` table migration from [`supabase/migrations/`](supabase/migrations/)
to the staging Supabase project (SQL Editor or migration tooling).

### R2 CORS (uploads bucket)

Configure CORS on the **uploads bucket only** so browsers can PUT directly from
the app origin. Example (adjust origins to your staging/production domains):

```json
[
  {
    "AllowedOrigins": [
      "https://village-checkin-staging.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Keep the bucket **private** (no public access or r2.dev URL). Do not use wildcard
origins. Reads are served via short-lived presigned GET URLs minted by the API,
not via public bucket access.

Leave `R2_UPLOADS_BUCKET` unset to disable uploads gracefully (the gallery page
shows a notice; selfies and check-in are unaffected).

## Quick checklist

- [ ] `staging` branch pushed
- [ ] Staging Supabase project created + `schema.sql` applied
- [ ] Stripe test keys collected; webhook added after deploy
- [ ] Separate staging Kit account + keys (or left blank to disable)
- [ ] Staging Vercel project created, Root Dir `web`, Production Branch `staging`
- [ ] All `web/.env.staging.example` vars set in the staging project
- [ ] `PROD_DATABASE_URL` + `STAGING_DATABASE_URL` GitHub secrets added
- [ ] Seed Action run once to populate staging
- [ ] Uploads R2 bucket created + CORS configured; `R2_UPLOADS_BUCKET` + `UPLOAD_TOKEN_SECRET` set
- [ ] `uploads` table migration applied to staging Supabase
