export const MIGRATION_TAG = "first_monday_billing";

export function getFirstMondayOfMonth(year: number, monthIndex0: number): Date {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex0, 1));
  const dow = firstOfMonth.getUTCDay();
  const offset = (1 - dow + 7) % 7;
  return new Date(Date.UTC(year, monthIndex0, 1 + offset));
}

export function nextFirstMondayAnchor(from: Date = new Date()): Date {
  const thisMonth = getFirstMondayOfMonth(
    from.getUTCFullYear(),
    from.getUTCMonth()
  );
  if (thisMonth.getTime() > from.getTime()) return thisMonth;
  return getFirstMondayOfMonth(from.getUTCFullYear(), from.getUTCMonth() + 1);
}

// The first Monday of the month AFTER `from`'s month. New subscribers pay in
// full at signup, then re-anchor to this date — always next month's first
// Monday, regardless of where in the current month they signed up. (Date.UTC
// rolls a December +1 over into the following January.)
export function firstMondayOfNextMonth(from: Date = new Date()): Date {
  return getFirstMondayOfMonth(from.getUTCFullYear(), from.getUTCMonth() + 1);
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
