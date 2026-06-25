// Shared date math for "first Monday of the month" subscription billing.
//
// Stripe has no native "first Monday" billing anchor (`billing_cycle_anchor`
// only locks a fixed calendar day-of-month), so the billing date is computed
// here and applied via Subscription Schedules. Both the one-time migration
// script and the monthly cron job import from this single module.
//
// TIMEZONE: all math is done in UTC. If "first Monday" must instead be computed
// in a local timezone (e.g. `America/Toronto` so the boundary lands at local
// midnight rather than UTC midnight), this is the single place to adjust —
// convert the target wall-clock time to UTC inside `getFirstMondayOfMonth`.

// Written into schedule + phase + subscription metadata by the migration, and
// the only marker the cron will act on. Shared here so the migration script and
// the cron endpoint can never drift on the literal.
export const MIGRATION_TAG = "first_monday_billing";

/**
 * Returns the first Monday of the given month at 00:00:00 UTC.
 *
 * `monthIndex0` is 0-indexed (0 = January). Passing values outside 0–11 is
 * supported and rolls the year correctly via `Date.UTC` overflow behavior, so
 * callers may freely pass `month + 1` / `month + 2`.
 */
export function getFirstMondayOfMonth(year: number, monthIndex0: number): Date {
  // Day 1 of the (possibly overflowing) month, normalized by Date.UTC.
  const firstOfMonth = new Date(Date.UTC(year, monthIndex0, 1));
  // getUTCDay(): 0 = Sunday, 1 = Monday, ... 6 = Saturday.
  const dow = firstOfMonth.getUTCDay();
  // Days to add to reach the first Monday (Monday === 1).
  const offset = (1 - dow + 7) % 7;
  return new Date(Date.UTC(year, monthIndex0, 1 + offset));
}

/**
 * Returns the next upcoming first-Monday anchor relative to `from`:
 * this month's first Monday if it is still in the future, otherwise next
 * month's first Monday.
 */
export function nextFirstMondayAnchor(from: Date = new Date()): Date {
  const thisMonth = getFirstMondayOfMonth(
    from.getUTCFullYear(),
    from.getUTCMonth()
  );
  if (thisMonth.getTime() > from.getTime()) return thisMonth;
  return getFirstMondayOfMonth(from.getUTCFullYear(), from.getUTCMonth() + 1);
}

/** Floors a Date to whole Unix seconds (the unit Stripe expects). */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
