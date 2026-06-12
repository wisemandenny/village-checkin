#!/usr/bin/env bash
#
# Copies application data from the PRODUCTION Supabase database into the
# STAGING database (an exact, as-is copy of the four app tables).
#
# Requirements:
#   - PROD_DATABASE_URL     direct (session) connection string to production
#   - STAGING_DATABASE_URL  direct (session) connection string to staging
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

# Extract the host portion of each URL for a safety comparison.
host_of() {
  printf '%s' "$1" | sed -E 's#^[a-zA-Z]+://[^@]+@([^:/?]+).*#\1#'
}

prod_host="$(host_of "$PROD_DATABASE_URL")"
staging_host="$(host_of "$STAGING_DATABASE_URL")"

# Guard: never truncate when prod and staging resolve to the same host.
if [ "$prod_host" = "$staging_host" ]; then
  echo "Refusing to run: PROD and STAGING hosts are identical ($prod_host)." >&2
  exit 1
fi

# Tables loaded in FK-safe order (pg_dump emits dependency-ordered inserts).
TABLES=(villagers check_ins subscriptions studio_settings)

dump_file="$(mktemp)"
trap 'rm -f "$dump_file"' EXIT

echo "==> Dumping data from production ($prod_host)"
table_args=()
for t in "${TABLES[@]}"; do table_args+=(--table="public.$t"); done
pg_dump "$PROD_DATABASE_URL" \
  --data-only --no-owner --no-privileges \
  "${table_args[@]}" \
  -f "$dump_file"

echo "==> Clearing staging tables ($staging_host)"
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "truncate table check_ins, subscriptions, villagers, studio_settings restart identity cascade;"

echo "==> Restoring data into staging"
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$dump_file"

echo "==> Done. Staging seeded from production."
