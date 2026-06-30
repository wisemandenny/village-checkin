// Recurring weekly schedule that a cron uses to flip `checkins_enabled`.
//
// All times are wall-clock time in the studio's local timezone (Toronto, ON).
// We read the local weekday/hour/minute via Intl rather than doing UTC offset
// math, so the schedule stays correct across daylight saving transitions
// automatically. The window may wrap past the end of the week back to Sunday
// (e.g. open Sat 22:00, close Sun 02:00).

// The studio's fixed local timezone. America/Toronto carries the EST/EDT DST
// rules, so wall-clock open/close times shift with daylight saving on their own.
export const STUDIO_TIMEZONE = "America/Toronto";

export interface ScheduleBoundary {
  // 0 = Sunday .. 6 = Saturday
  day: number;
  // "HH:MM" 24-hour wall-clock time in the studio's local timezone
  time: string;
}

export interface CheckinSchedule {
  // When false, the cron no-ops and check-ins stay under manual control.
  enabled: boolean;
  open: ScheduleBoundary;
  close: ScheduleBoundary;
}

export const DEFAULT_CHECKIN_SCHEDULE: CheckinSchedule = {
  enabled: false,
  open: { day: 1, time: "17:00" },
  close: { day: 2, time: "04:00" },
};

const MINUTES_PER_WEEK = 7 * 24 * 60;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  const hours = Number.isFinite(h) ? h : 0;
  const mins = Number.isFinite(m) ? m : 0;
  return hours * 60 + mins;
}

// Minute offset from the start of the week (Sunday 00:00) for a boundary.
function boundaryToMinuteOfWeek(b: ScheduleBoundary): number {
  const day = ((b.day % 7) + 7) % 7;
  return day * 24 * 60 + parseTimeToMinutes(b.time);
}

// Current wall-clock minute-of-week in the studio's local timezone.
function minuteOfWeek(date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const part of fmt.formatToParts(date)) {
    if (part.type === "weekday") {
      weekday = WEEKDAY_INDEX[part.value] ?? 0;
    } else if (part.type === "hour") {
      // Intl can emit "24" for midnight under hour12:false; normalize to 0.
      const h = parseInt(part.value, 10);
      hour = h === 24 ? 0 : h;
    } else if (part.type === "minute") {
      minute = parseInt(part.value, 10);
    }
  }

  return weekday * 24 * 60 + hour * 60 + minute;
}

// Coerce arbitrary stored JSON into a CheckinSchedule, falling back to defaults
// for any missing/invalid fields so the cron and admin UI never crash on bad data.
export function normalizeSchedule(value: unknown): CheckinSchedule {
  const v = (value ?? {}) as Partial<CheckinSchedule>;
  const open = (v.open ?? {}) as Partial<ScheduleBoundary>;
  const close = (v.close ?? {}) as Partial<ScheduleBoundary>;

  const validTime = (t: unknown): t is string =>
    typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t);
  const validDay = (d: unknown): d is number =>
    typeof d === "number" && d >= 0 && d <= 6;

  return {
    enabled: v.enabled === true,
    open: {
      day: validDay(open.day) ? open.day : DEFAULT_CHECKIN_SCHEDULE.open.day,
      time: validTime(open.time) ? open.time : DEFAULT_CHECKIN_SCHEDULE.open.time,
    },
    close: {
      day: validDay(close.day) ? close.day : DEFAULT_CHECKIN_SCHEDULE.close.day,
      time: validTime(close.time)
        ? close.time
        : DEFAULT_CHECKIN_SCHEDULE.close.time,
    },
  };
}

// Whether check-ins should be open at `now` given the schedule. The window runs
// from `open` (inclusive) to `close` (exclusive) and may wrap across the week
// boundary. An open === close window is treated as always open.
export function isOpenAt(schedule: CheckinSchedule, now: Date): boolean {
  const start = boundaryToMinuteOfWeek(schedule.open);
  const end = boundaryToMinuteOfWeek(schedule.close);
  const current = minuteOfWeek(now);

  if (start === end) return true;

  if (start < end) {
    // Non-wrapping window, e.g. Mon 09:00 -> Mon 17:00.
    return current >= start && current < end;
  }

  // Wrapping window: the close boundary falls earlier in the week than the
  // open boundary, so the window runs past the end of the week back to Sunday
  // (e.g. open Sat 22:00, close Sun 02:00).
  const normalizedEnd = end + MINUTES_PER_WEEK;
  const normalizedCurrent =
    current >= start ? current : current + MINUTES_PER_WEEK;
  return normalizedCurrent >= start && normalizedCurrent < normalizedEnd;
}
