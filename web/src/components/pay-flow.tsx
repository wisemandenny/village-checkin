"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PaymentStep } from "@/components/payment-step";
import { Spinner } from "@/components/motion/spinner";

interface CheckInData {
  check_in: { id: string; status: string; intent_amount: number };
  villager: { display_name: string | null };
  already_paid: boolean;
}

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "paid"; firstName: string | null }
  | { kind: "ready"; data: CheckInData }
  | { kind: "done" };

function firstNameOf(displayName: string | null): string | null {
  if (!displayName) return null;
  return displayName.trim().split(/\s+/)[0] || null;
}

// Settle-payment screen reached from an unpaid-check-in reminder email. The
// signed token (in the URL path) both authenticates the visitor and identifies
// the check-in, so there is no device recovery: the payment uses the existing
// one-time flow keyed on check_in_id, and the Stripe webhook flips the row to
// paid.
export function PayFlow({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/checkin/by-token?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("invalid");
        return (await res.json()) as CheckInData;
      })
      .then((data) => {
        if (cancelled) return;
        if (data.already_paid) {
          setState({ kind: "paid", firstName: firstNameOf(data.villager.display_name) });
        } else {
          setState({ kind: "ready", data });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleComplete = useCallback((paid?: boolean) => {
    if (paid) setState({ kind: "done" });
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 text-[var(--color-muted)]">
        <Spinner className="h-6 w-6" />
        <p className="text-sm">Loading your check-in…</p>
      </div>
    );
  }

  if (state.kind === "invalid") {
    return (
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold font-[family-name:var(--font-domaine)]">
          Link expired
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          This payment link is invalid or has expired. You can still settle up
          from the home screen on your next visit.
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex h-12 items-center rounded-2xl bg-[var(--color-accent)] px-8 font-semibold text-white transition hover:bg-[var(--color-accent-light)]"
        >
          Go to Home
        </Link>
      </div>
    );
  }

  if (state.kind === "paid" || state.kind === "done") {
    const firstName = state.kind === "paid" ? state.firstName : null;
    return (
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="mb-2 flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10">
          <svg
            className="h-10 w-10 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold font-[family-name:var(--font-domaine)]">
          {state.kind === "done"
            ? "Payment complete!"
            : "Already taken care of"}
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          {state.kind === "done"
            ? "Thanks for supporting the Village."
            : `This check-in is already paid${firstName ? `, ${firstName}` : ""}. Thanks for supporting the Village.`}
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex h-12 items-center rounded-2xl bg-[var(--color-accent)] px-8 font-semibold text-white transition hover:bg-[var(--color-accent-light)]"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  const firstName = firstNameOf(state.data.villager.display_name);
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6">
      <p className="text-center text-sm text-[var(--color-muted)]">
        {firstName ? `Hi ${firstName}! ` : ""}Finish supporting the Village for
        your recent visit.
      </p>
      <PaymentStep
        checkInId={state.data.check_in.id}
        deviceId=""
        allowCash={false}
        viaReminder
        onComplete={handleComplete}
      />
    </div>
  );
}
