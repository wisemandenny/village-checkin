"use client";

import { useEffect, useState } from "react";
import { Reveal } from "@/components/motion";
import { getDeviceId } from "@/lib/device-id";
import { formatWeekLabel } from "@/lib/checkin-streaks";

interface StreakData {
  current: number;
  best: number;
  best_is_current: boolean;
}

export function CheckInStreak({
  deviceId,
  delay = 260,
}: {
  deviceId?: string | null;
  delay?: number;
}) {
  const [streak, setStreak] = useState<StreakData | null>(null);

  useEffect(() => {
    const id = deviceId ?? getDeviceId();
    if (!id) return;

    let cancelled = false;
    fetch(`/api/checkin/streak?device_id=${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.current !== "number" || data.current < 1) return;
        setStreak({
          current: data.current,
          best: data.best ?? data.current,
          best_is_current: data.best_is_current === true,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  if (!streak) return null;

  const showBest = streak.best > streak.current;

  return (
    <Reveal delay={delay}>
      <div className="flex flex-col items-center gap-1">
        <p className="text-base font-semibold text-[var(--color-foreground)]">
          {formatWeekLabel(streak.current)} check-in streak
        </p>
        {showBest && (
          <p className="text-xs text-[var(--color-muted)]">
            Best: {formatWeekLabel(streak.best)}
          </p>
        )}
      </div>
    </Reveal>
  );
}
