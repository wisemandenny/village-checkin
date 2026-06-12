"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PaymentStep } from "@/components/payment-step";
import { AnimatedCheck, Reveal } from "@/components/motion";
import type { PaymentMethod } from "@/lib/types";

type Step = "checking-in" | "payment" | "done" | "already";

interface CheckInFlowProps {
  deviceId: string;
  displayName: string;
  isNewRegistration?: boolean;
  onCheckInState?: (state: { checkInId: string | null; step: Step; paid: boolean }) => void;
}

// How often the phone re-checks its check-in status, so a cash payment recorded
// by an admin surfaces without the villager manually refreshing.
const STATUS_POLL_MS = 5000;

export function CheckInFlow({ deviceId, displayName, isNewRegistration = false, onCheckInState }: CheckInFlowProps) {
  const [step, setStep] = useState<Step>("checking-in");
  const [error, setError] = useState<string | null>(null);
  const [checkInId, setCheckInId] = useState<string | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [isExclusive, setIsExclusive] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [paid, setPaid] = useState(false);
  const [paidMethod, setPaidMethod] = useState<PaymentMethod | null>(null);

  const markPaid = useCallback((method: PaymentMethod | null) => {
    setPaid(true);
    setPaidMethod(method);
    setStep("done");
  }, []);

  // Surface the live check-in id, step, and whether a real payment completed so
  // the parent can run history-driven cleanup (browser Back) without owning this
  // state. `paid` lets the parent preserve a completed payment while still
  // cleaning up auto-bypassed visits (first-time / subscription / skipped).
  useEffect(() => {
    onCheckInState?.({ checkInId, step, paid });
  }, [checkInId, step, paid, onCheckInState]);

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
          const statusData = statusRes.ok
            ? await statusRes.json()
            : { check_in: null, has_active_subscription: false };
          const check_in = statusData.check_in;
          setHasActiveSubscription(statusData.has_active_subscription === true);
          if (check_in?.id) setCheckInId(check_in.id);
          if (check_in?.status === "paid") {
            markPaid(check_in.payment_method ?? null);
          } else {
            setStep("already");
          }
          return;
        }
        if (!checkinRes.ok) throw new Error("Check-in failed");

        const { check_in, has_active_subscription, is_exclusive, is_first_time } = await checkinRes.json();
        setCheckInId(check_in.id);
        setIsExclusive(is_exclusive === true);
        setHasActiveSubscription(has_active_subscription === true);
        setIsFirstTime(is_first_time === true);

        if (settings.payments_enabled === true && !has_active_subscription && !is_first_time) {
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
                    const { check_in, has_active_subscription, is_exclusive, is_first_time } = await res.json();
                    setCheckInId(check_in.id);
                    setIsExclusive(is_exclusive === true);
                    setHasActiveSubscription(has_active_subscription === true);
                    setIsFirstTime(is_first_time === true);
                    if (paymentsEnabled && !has_active_subscription && !is_first_time) {
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
      </div>
    );
  }

  if (step === "payment" && checkInId) {
    return (
      <PaymentStep
        checkInId={checkInId}
        deviceId={deviceId}
        isExclusive={isExclusive}
        isNewRegistration={isNewRegistration}
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
      {hasActiveSubscription ? (
        <Reveal delay={220} className="flex flex-col items-center gap-3">
          <p className="text-sm text-green-600 dark:text-green-400">
            You&apos;re an active supporter — thanks for keeping the Village going!
          </p>
          <Link
            href="/manage"
            className="text-sm text-[var(--color-accent)] underline underline-offset-4 transition hover:text-[var(--color-accent-light)]"
          >
            Manage your support
          </Link>
        </Reveal>
      ) : (
        paid && (
          <Reveal delay={220}>
            <p className="text-sm text-green-600 dark:text-green-400">
              {paidMethod === "cash"
                ? "Cash payment received — thanks for supporting the Village!"
                : "Payment complete — thanks for supporting the Village!"}
            </p>
          </Reveal>
        )
      )}
      {!paid && isFirstTime && (
        <Reveal delay={220}>
          <p className="text-sm text-green-600 dark:text-green-400">
            Your first session is on us — make it count!
          </p>
        </Reveal>
      )}
    </div>
  );
}
