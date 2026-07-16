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
          className="absolute top-0 right-0 z-10 -translate-y-1/2 translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-bold leading-none text-white shadow-sm ring-2 ring-[var(--color-background)]"
          aria-label={`${current} week${current === 1 ? "" : "s"} streak`}
        >
          {current} week{current === 1 ? "" : "s"} streak
        </span>
      )}
    </div>
  );
}
