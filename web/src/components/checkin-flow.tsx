"use client";

import { useEffect, useState } from "react";
import { PaymentStep } from "@/components/payment-step";

interface CheckInFlowProps {
  deviceId: string;
  displayName: string;
  isNewRegistration?: boolean;
}

type Step = "checking-in" | "payment" | "done" | "already";

export function CheckInFlow({ deviceId, displayName, isNewRegistration = false }: CheckInFlowProps) {
  const [step, setStep] = useState<Step>("checking-in");
  const [error, setError] = useState<string | null>(null);
  const [checkInId, setCheckInId] = useState<string | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [paidSuccessfully, setPaidSuccessfully] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [checkinRes, settingsRes] = await Promise.all([
          fetch("/api/checkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_id: deviceId }),
          }),
          fetch("/api/settings"),
        ]);

        if (cancelled) return;

        const settings = settingsRes.ok ? await settingsRes.json() : {};
        setPaymentsEnabled(settings.payments_enabled === true);

        if (checkinRes.status === 409) {
          setStep("already");
          return;
        }
        if (!checkinRes.ok) throw new Error("Check-in failed");

        const { check_in, has_active_subscription } = await checkinRes.json();
        setCheckInId(check_in.id);

        if (settings.payments_enabled === true && !has_active_subscription) {
          setStep("payment");
        } else {
          setStep("done");
        }
      } catch {
        if (!cancelled) setError("Could not check in. Please try again.");
      }
    })();

    return () => { cancelled = true; };
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
                  .then(async (res) => {
                    if (res.status === 409) { setStep("already"); return; }
                    if (!res.ok) throw new Error("Check-in failed");
                    const { check_in, has_active_subscription } = await res.json();
                    setCheckInId(check_in.id);
                    if (paymentsEnabled && !has_active_subscription) {
                      setStep("payment");
                    } else {
                      setStep("done");
                    }
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

  if (step === "already") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-yellow-500/10">
          <svg
            className="h-10 w-10 text-yellow-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <h2 className="text-2xl font-bold">You&apos;re already checked in for today, {displayName}!</h2>
      </div>
    );
  }

  if (step === "payment" && checkInId) {
    return (
      <PaymentStep
        checkInId={checkInId}
        deviceId={deviceId}
        onComplete={(paid?: boolean) => {
          if (paid) setPaidSuccessfully(true);
          setStep("done");
        }}
      />
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
      <h2 className="text-2xl font-bold">
        {isNewRegistration ? "Welcome to the Village" : "Welcome back to the Village"}, {displayName}!
      </h2>
      {paidSuccessfully && (
        <p className="text-sm text-green-600 dark:text-green-400">
          Payment complete — thanks for supporting the Village!
        </p>
      )}
    </div>
  );
}
