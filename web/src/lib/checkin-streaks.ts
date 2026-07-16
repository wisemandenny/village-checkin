/**
 * Map any check-in timestamp to the Monday of its week.
 * Special case: Tue 12am–4am rolls back to the previous Monday (late session).
 */
export function toMondayOfWeek(iso: string): string {
  const d = new Date(iso);
  const day = d.getDay(); // 0=Sun..6=Sat
  const hour = d.getHours();

  if (day === 2 && hour < 4) {
    d.setDate(d.getDate() - 1);
  } else {
    const offset = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - offset);
  }

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface StreakResult {
  current: number;
  currentStart: string | null;
  best: number;
  bestStart: string | null;
  bestEnd: string | null;
  bestIsCurrent: boolean;
}

const EMPTY_STREAK: StreakResult = {
  current: 0,
  currentStart: null,
  best: 0,
  bestStart: null,
  bestEnd: null,
  bestIsCurrent: false,
};

/** Weekly check-in streak from a villager's check-in timestamps. */
export function computeStreaks(
  checkins: { created_at: string }[],
  nowIso: string = new Date().toISOString()
): StreakResult {
  if (checkins.length === 0) return EMPTY_STREAK;

  const mondaySet = new Set<string>();
  for (const c of checkins) {
    mondaySet.add(toMondayOfWeek(c.created_at));
  }

  // Sorted descending (most recent first)
  const mondays = [...mondaySet].sort().reverse();

  const thisMondayKey = toMondayOfWeek(nowIso);
  const thisMon = new Date(thisMondayKey + "T00:00:00");
  const latestMon = new Date(mondays[0] + "T00:00:00");
  const gapFromNow = Math.round(
    (thisMon.getTime() - latestMon.getTime()) / (1000 * 60 * 60 * 24)
  );

  let current = 0;
  let currentStart: string | null = null;
  if (gapFromNow <= 7) {
    let expected = latestMon;
    for (const m of mondays) {
      const curr = new Date(m + "T00:00:00");
      const diff = Math.round(
        (expected.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diff > 7) break;
      current++;
      currentStart = m;
      expected = new Date(curr);
      expected.setDate(expected.getDate() - 7);
    }
  }

  // Best streak: find the longest run of consecutive weeks anywhere.
  // mondays are sorted descending, so a run's "start" is the last index and
  // "end" is the first index.
  let best = 0;
  let bestStartIdx = 0;
  let bestEndIdx = 0;
  let run = 1;
  let runStartIdx = 0;
  for (let i = 1; i < mondays.length; i++) {
    const prev = new Date(mondays[i - 1] + "T00:00:00");
    const curr = new Date(mondays[i] + "T00:00:00");
    const diff = Math.round(
      (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diff <= 7) {
      run++;
    } else {
      if (run > best) {
        best = run;
        bestEndIdx = runStartIdx;
        bestStartIdx = i - 1;
      }
      run = 1;
      runStartIdx = i;
    }
  }
  if (run > best) {
    best = run;
    bestEndIdx = runStartIdx;
    bestStartIdx = mondays.length - 1;
  }

  const bestStart = mondays[bestStartIdx] ?? null;
  const bestEnd = mondays[bestEndIdx] ?? null;
  const bestIsCurrent = bestEnd === mondays[0] && gapFromNow <= 7;

  return { current, currentStart, best, bestStart, bestEnd, bestIsCurrent };
}

export function formatMondayMD(mondayKey: string): string {
  const d = new Date(mondayKey + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatWeekLabel(weeks: number): string {
  return `${weeks} wk${weeks !== 1 ? "s" : ""}`;
}
