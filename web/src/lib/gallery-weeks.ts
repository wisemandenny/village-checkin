import { STUDIO_TIMEZONE } from "@/lib/checkin-schedule";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Calendar date parts in the studio timezone. */
function torontoParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
  const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  let year = 0;
  let month = 0;
  let day = 0;
  let weekday = 0;
  for (const part of fmt.formatToParts(date)) {
    if (part.type === "year") year = parseInt(part.value, 10);
    else if (part.type === "month") month = parseInt(part.value, 10);
    else if (part.type === "day") day = parseInt(part.value, 10);
    else if (part.type === "weekday") weekday = WEEKDAY_INDEX[part.value] ?? 0;
  }
  return { year, month, day, weekday };
}

/**
 * Stable key for the Monday-start week containing `iso`, in America/Toronto.
 * Week runs Monday 00:00 through Sunday 23:59 (studio local time).
 * Format: YYYY-MM-DD of that Monday.
 */
export function weekKey(iso: string): string {
  const parts = torontoParts(new Date(iso));
  // Build a UTC noon date for the local calendar day so subtracting weekdays
  // doesn't cross a DST edge into the wrong day.
  const localNoon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  // weekday: 0=Sun..6=Sat → days since Monday
  const daysFromMonday = (parts.weekday + 6) % 7;
  localNoon.setUTCDate(localNoon.getUTCDate() - daysFromMonday);
  const y = localNoon.getUTCFullYear();
  const m = String(localNoon.getUTCMonth() + 1).padStart(2, "0");
  const d = String(localNoon.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True when `iso` falls in the Monday–Sunday week that contains `now`. */
export function isInCurrentMondayWeek(iso: string, now = new Date()): boolean {
  return weekKey(iso) === weekKey(now.toISOString());
}

function parseWeekKey(key: string): Date {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

/** Human label for a week key: This week / Last week / Jun 1–7, 2026. */
export function weekLabel(key: string, now = new Date()): string {
  const thisWeek = weekKey(now.toISOString());
  if (key === thisWeek) return "This week";

  const lastWeekDate = new Date(now.getTime() - 7 * MS_PER_DAY);
  if (key === weekKey(lastWeekDate.toISOString())) return "Last week";

  const start = parseWeekKey(key);
  const end = new Date(start.getTime() + 6 * MS_PER_DAY);
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const nowYear = torontoParts(now).year;

  if (startYear === endYear) {
    const range = `${formatDay(start)} – ${formatDay(end)}`;
    return startYear === nowYear ? range : `${range}, ${startYear}`;
  }
  return `${formatDay(start)}, ${startYear} – ${formatDay(end)}, ${endYear}`;
}

export interface WeekGroup<T extends { created_at: string }> {
  key: string;
  label: string;
  items: T[];
}

/** Group already-sorted (newest-first) items into Monday-start week buckets. */
export function groupByWeek<T extends { created_at: string }>(
  items: T[],
  now = new Date()
): WeekGroup<T>[] {
  const groups: WeekGroup<T>[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const key = weekKey(item.created_at);
    const existing = indexByKey.get(key);
    if (existing !== undefined) {
      groups[existing].items.push(item);
      continue;
    }
    indexByKey.set(key, groups.length);
    groups.push({ key, label: weekLabel(key, now), items: [item] });
  }

  return groups;
}
