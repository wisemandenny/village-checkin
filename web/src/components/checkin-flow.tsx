"use client";

import { useState } from "react";

interface CheckInFlowProps {
  deviceId: string;
  displayName: string;
}

const AMOUNT_OPTIONS = [
  { label: "$0", cents: 0 },
  { label: "$5", cents: 500 },
  { label: "$10", cents: 1000 },
  { label: "$20", cents: 2000 },
  { label: "$50", cents: 5000 },
];

type Step = "amount" | "method" | "waiting" | "done";

export function CheckInFlow({ deviceId, displayName }: CheckInFlowProps) {
  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCents =
    amount !== null ? amount : customAmount ? Math.round(parseFloat(customAmount) * 100) : 0;

  async function handleCheckin(method: "terminal" | "online_fallback" | "skipped") {
    setLoading(true);
    setError(null);

    try {
      const checkinRes = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          intent_amount: selectedCents,
          payment_method: method,
        }),
      });

      if (!checkinRes.ok) {
        const data = await checkinRes.json();
        throw new Error(data.error || "Check-in failed");
      }

      const { check_in } = await checkinRes.json();

      if (method === "skipped" || selectedCents === 0) {
        setStep("done");
        return;
      }

      if (method === "terminal") {
        const termRes = await fetch("/api/terminal-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ check_in_id: check_in.id, amount: selectedCents }),
        });
        if (!termRes.ok) throw new Error("Failed to send to terminal");
        setStep("waiting");
        return;
      }

      if (method === "online_fallback") {
        const fallbackRes = await fetch("/api/checkout-fallback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ check_in_id: check_in.id, amount: selectedCents }),
        });
        if (!fallbackRes.ok) throw new Error("Failed to create checkout session");
        const { url } = await fallbackRes.json();
        window.location.href = url;
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10">
          <svg className="h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold">You&apos;re checked in!</h2>
          <p className="mt-2 text-[var(--color-muted)]">Welcome to the studio, {displayName}.</p>
        </div>
      </div>
    );
  }

  if (step === "waiting") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="h-16 w-16 animate-pulse rounded-full bg-[var(--color-accent)]/20" />
        <div>
          <h2 className="text-2xl font-bold">Head to the front desk</h2>
          <p className="mt-2 text-[var(--color-muted)]">
            Tap your card on the tablet to complete your ${(selectedCents / 100).toFixed(2)} payment.
          </p>
        </div>
        <button
          onClick={() => setStep("done")}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)]"
        >
          I&apos;ll pay later
        </button>
      </div>
    );
  }

  if (step === "method") {
    return (
      <div className="flex flex-col gap-6 w-full max-w-sm">
        <div className="text-center">
          <h2 className="text-2xl font-bold">
            Pay ${(selectedCents / 100).toFixed(2)}
          </h2>
          <p className="mt-1 text-[var(--color-muted)]">Choose how to pay</p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleCheckin("terminal")}
            disabled={loading}
            className="flex h-16 items-center justify-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-lg font-medium transition-all hover:border-[var(--color-accent)]/40 disabled:opacity-40"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
            </svg>
            Tap at Front Desk
          </button>

          <button
            onClick={() => handleCheckin("online_fallback")}
            disabled={loading}
            className="flex h-16 items-center justify-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-lg font-medium transition-all hover:border-[var(--color-accent)]/40 disabled:opacity-40"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
            Pay Online
          </button>
        </div>

        {error && <p className="text-sm text-red-500 text-center">{error}</p>}

        <button
          onClick={() => setStep("amount")}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)]"
        >
          Change amount
        </button>
      </div>
    );
  }

  // Step: amount
  return (
    <div className="flex flex-col gap-8 w-full max-w-sm">
      <div className="text-center">
        <h2 className="text-2xl font-bold">Hey {displayName}!</h2>
        <p className="mt-1 text-[var(--color-muted)]">Pay what you can for today&apos;s session</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {AMOUNT_OPTIONS.map((opt) => (
          <button
            key={opt.cents}
            type="button"
            onClick={() => {
              setAmount(opt.cents);
              setCustomAmount("");
            }}
            className={`h-14 rounded-xl border text-lg font-semibold transition-all ${
              amount === opt.cents && !customAmount
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] hover:border-[var(--color-accent)]/40"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[var(--color-muted)]">
            $
          </span>
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Other"
            value={customAmount}
            onChange={(e) => {
              setCustomAmount(e.target.value);
              setAmount(null);
            }}
            className="h-14 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] pl-7 pr-3 text-lg font-semibold focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all placeholder:text-[var(--color-muted)]/50"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={() => {
            if (selectedCents === 0) {
              handleCheckin("skipped");
            } else {
              setStep("method");
            }
          }}
          disabled={loading}
          className="h-14 rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {selectedCents === 0 ? "Check In (Free)" : `Continue — $${(selectedCents / 100).toFixed(2)}`}
        </button>
      </div>

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}
    </div>
  );
}
