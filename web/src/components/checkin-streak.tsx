"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getDeviceId } from "@/lib/device-id";

/** Wraps the success checkmark and overlays the current streak as a top-right badge. */
export function CheckInStreak({
  deviceId,
  children,
}: {
  deviceId?: string | null;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState<number | null>(null);

  useEffect(() => {
    const id = deviceId ?? getDeviceId();
    if (!id) return;

    let cancelled = false;
    fetch(`/api/checkin/streak?device_id=${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.current !== "number" || data.current < 1) return;
        setCurrent(data.current);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  return (
    <div className="relative inline-flex">
      {children}
      {current != null && (
        <span
          className="absolute -right-1 -top-1 flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-xs font-bold tabular-nums text-white shadow-sm ring-2 ring-[var(--color-background)]"
          title={`${current}-week check-in streak`}
          aria-label={`${current}-week check-in streak`}
        >
          {current}
        </span>
      )}
    </div>
  );
}
