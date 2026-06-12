#!/usr/bin/env bash
#
# Copies application data from the PRODUCTION Supabase database into the
# STAGING database (an exact, as-is copy of the four app tables).
#
# Requirements:
#   - PROD_DATABASE_URL     Session-pooler connection string to production
#   - STAGING_DATABASE_URL  Session-pooler connection string to staging
#     (Use Supabase's "Session pooler" string, not the direct connection — the
#     direct host is IPv6-only and won't resolve from IPv4 CI like GitHub
#     Actions. Replace [YOUR-PASSWORD] with the DB password, URL-encoded.)
#   - pg_dump / psql on PATH (PostgreSQL client matching your Supabase major
#     version; see STAGING.md)
#
# The staging schema must already exist (apply supabase/schema.sql to the
# staging project first). Existing staging rows in these tables are replaced.
#
# Usage:
#   PROD_DATABASE_URL=... STAGING_DATABASE_URL=... bash scripts/seed-staging-db.sh
set -euo pipefail

: "${PROD_DATABASE_URL:?Set PROD_DATABASE_URL}"
: "${STAGING_DATABASE_URL:?Set STAGING_DATABASE_URL}"

# Extract the Supabase project ref for a safety comparison. The ref appears in
# the direct host (db.<ref>.supabase.co) OR in the pooler username
# (postgres.<ref>) — the latter matters because all projects in a region share
# the same pooler host, so comparing hosts alone is not enough.
ref_of() {
  url="$1"
  ref="$(printf '%s' "$url" | sed -nE 's#^[a-zA-Z]+://[^@]+@db\.([a-z0-9]+)\.supabase\.co.*#\1#p')"
  if [ -z "$ref" ]; then
    ref="$(printf '%s' "$url" | sed -nE 's#^[a-zA-Z]+://postgres\.([a-z0-9]+):.*#\1#p')"
  fi
  if [ -z "$ref" ]; then
    # Fallback to the full host for non-Supabase URLs.
    ref="$(printf '%s' "$url" | sed -E 's#^[a-zA-Z]+://[^@]+@([^:/?]+).*#\1#')"
  fi
  printf '%s' "$ref"
}

prod_ref="$(ref_of "$PROD_DATABASE_URL")"
staging_ref="$(ref_of "$STAGING_DATABASE_URL")"

if [ -z "$prod_ref" ] || [ -z "$staging_ref" ]; then
  echo "Could not determine the project identity from the connection URLs." >&2
  exit 1
fi

# Guard: never truncate when prod and staging point at the same project.
if [ "$prod_ref" = "$staging_ref" ]; then
  echo "Refusing to run: PROD and STAGING point at the same project ($prod_ref)." >&2
  exit 1
fi

# Tables loaded in FK-safe order (pg_dump emits dependency-ordered inserts).
TABLES=(villagers check_ins subscriptions studio_settings)

dump_file="$(mktemp)"
trap 'rm -f "$dump_file"' EXIT

echo "==> Dumping data from production ($prod_ref)"
table_args=()
for t in "${TABLES[@]}"; do table_args+=(--table="public.$t"); done
pg_dump "$PROD_DATABASE_URL" \
  --data-only --no-owner --no-privileges \
  "${table_args[@]}" \
  -f "$dump_file"

echo "==> Clearing staging tables ($staging_ref)"
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "truncate table check_ins, subscriptions, villagers, studio_settings restart identity cascade;"

echo "==> Restoring data into staging"
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$dump_file"

echo "==> Done. Staging seeded from production."
