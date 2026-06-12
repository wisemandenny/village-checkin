"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PaymentStep } from "@/components/payment-step";
import { AnimatedCheck, Reveal } from "@/components/motion";
import type { PaymentMethod } from "@/lib/types";

interface CheckInFlowProps {
  deviceId: string;
  displayName: string;
  isNewRegistration?: boolean;
}

type Step = "checking-in" | "payment" | "done" | "already";

// How often the phone re-checks its check-in status, so a cash payment recorded
// by an admin surfaces without the villager manually refreshing.
const STATUS_POLL_MS = 5000;

export function CheckInFlow({ deviceId, displayName, isNewRegistration = false }: CheckInFlowProps) {
  const [step, setStep] = useState<Step>("checking-in");
  const [error, setError] = useState<string | null>(null);
  const [checkInId, setCheckInId] = useState<string | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [isExclusive, setIsExclusive] = useState(false);
  const [paid, setPaid] = useState(false);
  const [paidMethod, setPaidMethod] = useState<PaymentMethod | null>(null);

  const markPaid = useCallback((method: PaymentMethod | null) => {
    setPaid(true);
    setPaidMethod(method);
    setStep("done");
  }, []);

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

        // Already checked in today (e.g. a refresh): read the real status so a
        // completed payment — including cash recorded by an admin — is shown.
        if (checkinRes.status === 409) {
          const statusRes = await fetch(
            `/api/checkin/status?device_id=${encodeURIComponent(deviceId)}`
          );
          if (cancelled) return;
          const { check_in } = statusRes.ok
            ? await statusRes.json()
            : { check_in: null };
          if (check_in?.id) setCheckInId(check_in.id);
          if (check_in?.status === "paid") {
            markPaid(check_in.payment_method ?? null);
          } else {
            setStep("already");
          }
          return;
        }
        if (!checkinRes.ok) throw new Error("Check-in failed");

        const { check_in, has_active_subscription, is_exclusive } = await checkinRes.json();
        setCheckInId(check_in.id);
        setIsExclusive(is_exclusive === true);

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
  }, [deviceId, markPaid]);

  // While the villager is waiting to pay (or sitting on the "already checked
  // in" screen), poll for a status change so an admin-recorded cash payment
  // flips the screen to a completed state without a manual refresh.
  useEffect(() => {
    if (paid) return;
    if (step !== "payment" && step !== "already") return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/checkin/status?device_id=${encodeURIComponent(deviceId)}`
        );
        if (cancelled || !res.ok) return;
        const { check_in } = await res.json();
        if (check_in?.status === "paid") {
          markPaid(check_in.payment_method ?? null);
        }
      } catch {
        // Transient network errors are ignored; the next tick retries.
      }
    }, STATUS_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, paid, deviceId, markPaid]);

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
                    const { check_in, has_active_subscription, is_exclusive } = await res.json();
                    setCheckInId(check_in.id);
                    setIsExclusive(is_exclusive === true);
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
        <Reveal className="flex h-20 w-20 items-center justify-center rounded-full bg-yellow-500/10">
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
        </Reveal>
        <Reveal delay={120}>
          <h2 className="text-2xl font-bold">You&apos;re already checked in for today, {displayName}!</h2>
        </Reveal>
        <WhosHereLink />
      </div>
    );
  }

  if (step === "payment" && checkInId) {
    return (
      <PaymentStep
        checkInId={checkInId}
        deviceId={deviceId}
        isExclusive={isExclusive}
        onComplete={(didPay?: boolean) => {
          if (didPay) {
            markPaid(null);
          } else {
            setStep("done");
          }
        }}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <Reveal className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10">
        <AnimatedCheck className="h-10 w-10 text-green-500" />
      </Reveal>
      <Reveal delay={120}>
        <h2 className="text-2xl font-bold">
          {isNewRegistration ? "Welcome to the Village" : "Welcome back to the Village"}, {displayName}!
        </h2>
      </Reveal>
      {paid && (
        <Reveal delay={220}>
          <p className="text-sm text-green-600 dark:text-green-400">
            {paidMethod === "cash"
              ? "Cash payment received — thanks for supporting the Village!"
              : "Payment complete — thanks for supporting the Village!"}
          </p>
        </Reveal>
      )}
      <WhosHereLink />
    </div>
  );
}

// Deliberately understated entry point to the avatar board — small and
// low-contrast, more of a quiet easter egg than a call to action.
function WhosHereLink() {
  return (
    <Link
      href="/here"
      className="mt-2 text-xs text-[var(--color-muted)]/60 underline-offset-4 transition hover:text-[var(--color-muted)] hover:underline"
    >
      see who&apos;s here
    </Link>
  );
}
