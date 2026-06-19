"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PaymentStep } from "@/components/payment-step";
import { AnimatedCheck } from "@/components/motion";

interface PastCheckIn {
  id: string;
  status: string;
  payment_method: string | null;
  intent_amount: number | null;
  created_at: string;
}

interface CheckinsDisabledProps {
  deviceId: string;
  displayName: string;
  isNewRegistration?: boolean;
}

type View = "landing" | "subscribe" | "pay" | "done";

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Landing experience shown when the studio has check-ins closed. No visit is
// recorded; instead villagers can still subscribe (exclusive recurring support)
// and settle a past session they attended but never paid for.
export function CheckinsDisabled({ deviceId, displayName, isNewRegistration = false }: CheckinsDisabledProps) {
  const [view, setView] = useState<View>("landing");
  const [loading, setLoading] = useState(true);
  const [unpaid, setUnpaid] = useState<PastCheckIn[]>([]);
  const [isExclusive, setIsExclusive] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [selected, setSelected] = useState<PastCheckIn | null>(null);

  const firstName = displayName.trim().split(/\s+/)[0] || displayName;

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    fetch(`/api/checkin/unpaid?device_id=${encodeURIComponent(deviceId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setUnpaid(data.check_ins ?? []);
        setIsExclusive(data.is_exclusive === true);
        setHasActiveSubscription(data.has_active_subscription === true);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  if (view === "done") {
    return (
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <AnimatedCheck />
        <h2 className="text-3xl font-bold font-[family-name:var(--font-domaine)]">
          Thanks for supporting the Village!
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Your payment is complete.
        </p>
        <button
          onClick={() => {
            setSelected(null);
            setView("landing");
          }}
          className="mt-2 text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
        >
          &larr; Back
        </button>
      </div>
    );
  }

  if (view === "subscribe") {
    return (
      <div className="flex w-full flex-col items-center gap-6">
        <PaymentStep
          deviceId={deviceId}
          isExclusive
          isNewRegistration={isNewRegistration}
          onComplete={(paid) => setView(paid ? "done" : "landing")}
        />
        <button
          onClick={() => setView("landing")}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
        >
          &larr; Back
        </button>
      </div>
    );
  }

  if (view === "pay" && selected) {
    return (
      <div className="flex w-full flex-col items-center gap-6">
        <p className="text-sm text-[var(--color-muted)]">
          Paying for your session on {formatDay(selected.created_at)}
        </p>
        <PaymentStep
          checkInId={selected.id}
          deviceId={deviceId}
          isExclusive={isExclusive}
          onComplete={(paid) => {
            if (paid) {
              setUnpaid((prev) => prev.filter((c) => c.id !== selected.id));
              setView("done");
            } else {
              setView("landing");
            }
          }}
        />
        <button
          onClick={() => {
            setSelected(null);
            setView("landing");
          }}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
        >
          &larr; Back
        </button>
      </div>
    );
  }

  const canSubscribe = isExclusive && !hasActiveSubscription;

  // Decide whether to nag about settling a past session.
  // - One-time payers (non-exclusive): always nag for any unpaid visit.
  // - Exclusive-tier supporters (subscribers): only nag once an unpaid visit
  //   has rolled into a prior billing cycle. Visits from the current cycle
  //   (this calendar month) are still "current"; an unpaid visit from a
  //   previous cycle (an earlier month) means they owe for a closed period.
  const startOfCurrentCycle = new Date();
  startOfCurrentCycle.setDate(1);
  startOfCurrentCycle.setHours(0, 0, 0, 0);
  const showUnpaid = isExclusive
    ? unpaid.some((c) => new Date(c.created_at) < startOfCurrentCycle)
    : unpaid.length > 0;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-3xl font-bold font-[family-name:var(--font-domaine)]">
          {firstName ? `Welcome, ${firstName}!` : "Welcome!"}
        </h2>
        <p className="text-[var(--color-muted)]">
          Check-ins are closed right now.
        </p>
      </div>

      {!loading && (canSubscribe || showUnpaid) && (
        <div className="w-full space-y-4">
          {canSubscribe && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-left">
              <h3 className="font-semibold">Support the Village</h3>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                $10/month keeps the Village alive.
              </p>
              <button
                onClick={() => setView("subscribe")}
                className="mt-3 h-11 w-full rounded-2xl bg-[var(--color-accent)] px-4 text-sm font-semibold font-[family-name:var(--font-domaine)] text-white transition hover:bg-[var(--color-accent-light)]"
              >
                Subscribe
              </button>
            </div>
          )}

          {showUnpaid && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-left">
              <h3 className="font-semibold">Pay for a past session</h3>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Attended a session but didn&rsquo;t pay? Settle up here.
              </p>
              <div className="mt-3 space-y-2">
                {unpaid.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelected(c);
                      setView("pay");
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3 text-sm transition hover:border-[var(--color-accent)]/50"
                  >
                    <span className="font-medium">{formatDay(c.created_at)}</span>
                    <span className="text-[var(--color-accent)]">Pay &rarr;</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {hasActiveSubscription && (
        <Link
          href="/manage"
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
        >
          Manage your support
        </Link>
      )}
    </div>
  );
}
