"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PaymentStep } from "@/components/payment-step";
import { AnimatedCheck, Reveal } from "@/components/motion";
import { GalleryMosaic } from "@/components/gallery/gallery-mosaic";
import { CheckInStreak } from "@/components/checkin-streak";
import type { PaymentMethod } from "@/lib/types";

type Step = "checking-in" | "payment" | "done";

interface CheckInFlowProps {
  deviceId: string;
  displayName: string;
  isNewRegistration?: boolean;
  onCheckInState?: (state: {
    checkInId: string | null;
    step: Step;
    paid: boolean;
    alreadyCheckedIn: boolean;
  }) => void;
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
  const [paid, setPaid] = useState(false);
  const [paidMethod, setPaidMethod] = useState<PaymentMethod | null>(null);
  // True when this visit's check-in row predates this session (the server
  // returned 409). The parent uses this to skip Back-button cleanup so an
  // existing check-in is never deleted.
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);

  const firstName = displayName.trim().split(/\s+/)[0] || displayName;

  const markPaid = useCallback((method: PaymentMethod | null) => {
    setPaid(true);
    setPaidMethod(method);
    setStep("done");
  }, []);

  // Surface the live check-in id, step, and whether a real payment completed so
  // the parent can run history-driven cleanup (browser Back) without owning this
  // state. `paid` lets the parent preserve a completed payment while still
  // cleaning up auto-bypassed visits (subscription / skipped).
  useEffect(() => {
    onCheckInState?.({ checkInId, step, paid, alreadyCheckedIn });
  }, [checkInId, step, paid, alreadyCheckedIn, onCheckInState]);

  // Already checked in today (the server returned 409). Read the real status
  // and route the same way a fresh check-in does: collect payment if it's owed,
  // otherwise land on the done/paid screen. This is shared by the initial mount
  // and the "Try again" retry so both behave identically.
  const routeAlreadyCheckedIn = useCallback(
    async (paymentsEnabledFlag: boolean, isCancelled: () => boolean = () => false) => {
      const statusRes = await fetch(
        `/api/checkin/status?device_id=${encodeURIComponent(deviceId)}`
      );
      if (isCancelled()) return;
      const statusData = statusRes.ok
        ? await statusRes.json()
        : { check_in: null, has_active_subscription: false, is_exclusive: false, is_elder: false };
      if (isCancelled()) return;

      const check_in = statusData.check_in;
      setHasActiveSubscription(statusData.has_active_subscription === true);
      setIsExclusive(statusData.is_exclusive === true);
      setAlreadyCheckedIn(true);
      if (check_in?.id) setCheckInId(check_in.id);

      if (check_in?.status === "paid") {
        markPaid(check_in.payment_method ?? null);
      } else if (
        paymentsEnabledFlag &&
        statusData.has_active_subscription !== true &&
        statusData.is_elder !== true &&
        check_in?.id
      ) {
        setStep("payment");
      } else {
        setStep("done");
      }
    },
    [deviceId, markPaid]
  );

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

        // Already checked in today (e.g. a refresh, or recovered after an
        // earlier unpaid visit): read the real status and route to payment or
        // the done/paid screen, so an outstanding payment is never skipped.
        if (checkinRes.status === 409) {
          await routeAlreadyCheckedIn(settings.payments_enabled === true, () => cancelled);
          return;
        }
        if (!checkinRes.ok) throw new Error("Check-in failed");

        const { check_in, has_active_subscription, is_exclusive, is_elder } = await checkinRes.json();
        setCheckInId(check_in.id);
        setIsExclusive(is_exclusive === true);
        setHasActiveSubscription(has_active_subscription === true);

        if (settings.payments_enabled === true && !has_active_subscription && !is_elder) {
          setStep("payment");
        } else {
          setStep("done");
        }
      } catch {
        if (!cancelled) setError("Could not check in. Please try again.");
      }
    })();

    return () => { cancelled = true; };
  }, [deviceId, markPaid, routeAlreadyCheckedIn]);

  // While the villager is waiting to pay, poll for a status change so an
  // admin-recorded cash payment flips the screen to a completed state without
  // a manual refresh.
  useEffect(() => {
    if (paid) return;
    if (step !== "payment") return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/checkin/status?device_id=${encodeURIComponent(deviceId)}`
        );
        if (cancelled || !res.ok) return;
        const { check_in, is_elder } = await res.json();
        if (is_elder === true) {
          markPaid("elder");
        } else if (check_in?.status === "paid") {
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
        <Image
          src="/potluck-chinese.png"
          alt="Loading…"
          width={1849}
          height={1622}
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
                    if (res.status === 409) {
                      await routeAlreadyCheckedIn(paymentsEnabled);
                      return;
                    }
                    if (!res.ok) throw new Error("Check-in failed");
                    const { check_in, has_active_subscription, is_exclusive, is_elder } = await res.json();
                    setCheckInId(check_in.id);
                    setIsExclusive(is_exclusive === true);
                    setHasActiveSubscription(has_active_subscription === true);
                    if (paymentsEnabled && !has_active_subscription && !is_elder) {
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
          {isNewRegistration ? "Welcome to the Village" : "Welcome back to the Village"}, {firstName}!
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
      <CheckInStreak deviceId={deviceId} />
      <GalleryMosaic deviceId={deviceId} />
      <CommunityLinks />
    </div>
  );
}

// Entry points to community pages. "See who's here" is the primary CTA; the
// gallery is reached inline via the mosaic's "Open full gallery" link, so no
// separate gallery button is needed here.
function CommunityLinks() {
  return (
    <div className="flex flex-col items-center gap-2">
      <Link
        href="/here"
        className="mt-2 inline-flex h-14 w-full items-center justify-center rounded-2xl bg-[var(--color-accent)] px-8 text-lg font-semibold text-white transition hover:bg-[var(--color-accent-light)] font-[family-name:var(--font-domaine)]"
      >
        See who&apos;s here
      </Link>
    </div>
  );
}
