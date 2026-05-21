"use client";

import { useEffect, useState } from "react";

interface CheckInFlowProps {
  deviceId: string;
  displayName: string;
}

type Step = "checking-in" | "done";

export function CheckInFlow({ deviceId, displayName }: CheckInFlowProps) {
  const [step, setStep] = useState<Step>("checking-in");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_id: deviceId }),
        });
        if (!res.ok) throw new Error("Check-in failed");
        if (!cancelled) setStep("done");
      } catch {
        if (!cancelled) setError("Could not check in. Please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  if (step === "checking-in") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <img
          src="/potluck-chinese.png"
          alt="Loading…"
          className="h-36 w-auto animate-pulse-slow"
        />
        <p className="text-[var(--color-muted)]">Checking you in...</p>
        {error && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-red-500">{error}</p>
            <button
              onClick={() => {
                setError(null);
                setStep("checking-in");
                fetch("/api/checkin", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ device_id: deviceId }),
                })
                  .then((res) => {
                    if (!res.ok) throw new Error("Check-in failed");
                    setStep("done");
                  })
                  .catch(() =>
                    setError("Could not check in. Please try again.")
                  );
              }}
              className="text-sm text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-accent-light)]"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10">
        <svg
          className="h-10 w-10 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <div>
        <h2 className="text-2xl font-bold">You&apos;re checked in!</h2>
        <p className="mt-2 text-[var(--color-muted)]">
          Welcome to the village, {displayName}. Enjoy your session.
        </p>
      </div>
    </div>
  );
}
