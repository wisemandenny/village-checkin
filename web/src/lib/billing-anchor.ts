// Recurring support is billed on the FIRST DAY of each month. A new supporter
// pays in full immediately at signup, then their subscription is anchored to
// the first of the next month and bills on the 1st every month thereafter.
//
// Because the 1st is a fixed calendar day, Stripe's native monthly billing keeps
// every cycle on the 1st forever — no schedules and no cron are required.

// Tags subscriptions/migrations moved onto first-of-month billing.
export const MIGRATION_TAG = "first_of_month_billing";

// The first day of the month AFTER `from`'s month, at 00:00 UTC. (Date.UTC
// rolls a December +1 over into the following January.)
export function firstOfNextMonth(from: Date = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
