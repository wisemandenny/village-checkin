"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

interface CheckInFlowProps {
  deviceId: string;
  displayName: string;
  pendingCheckInId?: string;
}

const AMOUNT_OPTIONS = [
  { label: "$5", cents: 500 },
  { label: "$10", cents: 1000 },
  { label: "$20", cents: 2000 },
  { label: "$50", cents: 5000 },
];

type Step =
  | "checking-in"
  | "amount"
  | "method"
  | "requesting"
  | "waiting"
  | "busy"
  | "paymentDone"
  | "done";

const CHECKIN_STORAGE_KEY = "studio_pending_checkin";
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function savePendingCheckIn(checkInId: string) {
  localStorage.setItem(
    CHECKIN_STORAGE_KEY,
    JSON.stringify({ check_in_id: checkInId, created_at: Date.now() })
  );
}

function clearPendingCheckIn() {
  localStorage.removeItem(CHECKIN_STORAGE_KEY);
}

function loadPendingCheckIn(): string | null {
  const raw = localStorage.getItem(CHECKIN_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.created_at > SIX_HOURS_MS) {
      clearPendingCheckIn();
      return null;
    }
    return parsed.check_in_id;
  } catch {
    clearPendingCheckIn();
    return null;
  }
}

export function CheckInFlow({
  deviceId,
  displayName,
  pendingCheckInId,
}: CheckInFlowProps) {
  const [step, setStep] = useState<Step>(
    pendingCheckInId ? "amount" : "checking-in"
  );
  const [checkInId, setCheckInId] = useState<string | null>(
    pendingCheckInId ?? null
  );
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createBrowserClient>["channel"]
  > | null>(null);

  const selectedCents =
    amount !== null
      ? amount
      : customAmount
        ? Math.round(parseFloat(customAmount) * 100)
        : 0;

  // Register check-in immediately on mount (if not resuming a pending one)
  useEffect(() => {
    if (pendingCheckInId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_id: deviceId }),
        });
        if (!res.ok) throw new Error("Check-in failed");
        const { check_in } = await res.json();
        if (cancelled) return;
        setCheckInId(check_in.id);
        savePendingCheckIn(check_in.id);
        setStep("amount");
      } catch {
        if (!cancelled) setError("Could not check in. Please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, pendingCheckInId]);

  // Subscribe to Supabase Realtime for payment ack & result
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel("terminal_room")
      .on("broadcast", { event: "payment_ack" }, ({ payload: p }) => {
        if (!p || p.request_id !== requestIdRef.current) return;
        if (p.status === "rejected") {
          setStep("busy");
          setLoading(false);
        } else if (p.status === "accepted") {
          setStep("waiting");
          setLoading(false);
        }
      })
      .on("broadcast", { event: "payment_result" }, ({ payload: p }) => {
        if (!p || p.request_id !== requestIdRef.current) return;
        if (p.status === "success") {
          setStep("paymentDone");
        } else {
          setError(p.reason || "Payment failed at the terminal");
          setStep("amount");
        }
        setLoading(false);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const sendTerminalRequest = useCallback(
    async (cents: number) => {
      if (!checkInId) return;
      setLoading(true);
      setError(null);

      const reqId = crypto.randomUUID();
      requestIdRef.current = reqId;
      setStep("requesting");

      try {
        const res = await fetch("/api/terminal-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            check_in_id: checkInId,
            amount: cents,
            request_id: reqId,
          }),
        });
        if (!res.ok) throw new Error("Failed to send to terminal");
      } catch {
        setError("Could not reach the terminal. Try again.");
        setStep("method");
        setLoading(false);
      }
    },
    [checkInId]
  );

  async function handleMethodSelect(
    method: "terminal" | "online_fallback" | "skipped"
  ) {
    if (method === "skipped" || selectedCents === 0) {
      clearPendingCheckIn();
      setStep("done");
      return;
    }

    if (method === "terminal") {
      await sendTerminalRequest(selectedCents);
      return;
    }

    if (method === "online_fallback") {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/checkout-fallback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            check_in_id: checkInId,
            amount: selectedCents,
          }),
        });
        if (!res.ok) throw new Error("Failed to create checkout session");
        const { url } = await res.json();
        window.location.href = url;
      } catch {
        setError("Could not start online payment. Try again.");
        setLoading(false);
      }
    }
  }

  // --- RENDER ---

  if (step === "checking-in") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
        <p className="text-[var(--color-muted)]">Checking you in...</p>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  if (step === "done") {
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
            Welcome to the studio, {displayName}.
          </p>
        </div>
      </div>
    );
  }

  if (step === "paymentDone") {
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
          <h2 className="text-2xl font-bold">Payment complete!</h2>
          <p className="mt-2 text-[var(--color-muted)]">
            Thank you, {displayName}.
          </p>
        </div>
        <button
          onClick={() => {
            setAmount(null);
            setCustomAmount("");
            setError(null);
            setStep("amount");
          }}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)]"
        >
          Make another payment
        </button>
        <button
          onClick={() => {
            clearPendingCheckIn();
            setStep("done");
          }}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)]"
        >
          I&apos;m done
        </button>
      </div>
    );
  }

  if (step === "busy") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/10">
          <svg
            className="h-10 w-10 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold">It&apos;s busy</h2>
          <p className="mt-2 text-[var(--color-muted)]">
            The terminal is handling another payment right now.
          </p>
        </div>
        <button
          onClick={() => sendTerminalRequest(selectedCents)}
          disabled={loading}
          className="h-14 w-full max-w-xs rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Try again
        </button>
        <button
          onClick={() => {
            setError(null);
            setStep("method");
          }}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)]"
        >
          Choose a different method
        </button>
      </div>
    );
  }

  if (step === "requesting") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
        <p className="text-[var(--color-muted)]">
          Sending to the front desk...
        </p>
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
            Tap your card on the tablet to complete your $
            {(selectedCents / 100).toFixed(2)} payment.
          </p>
        </div>
        <button
          onClick={() => {
            setStep("amount");
            setError(null);
          }}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)]"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (step === "method") {
    return (
      <div className="flex flex-col gap-6 w-full max-w-sm">
        <div className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-green-500/10 px-4 py-1.5 text-sm font-medium text-green-500">
            <svg
              className="h-4 w-4"
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
            Checked in
          </div>
          <h2 className="text-2xl font-bold">
            Pay ${(selectedCents / 100).toFixed(2)}
          </h2>
          <p className="mt-1 text-[var(--color-muted)]">Choose how to pay</p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleMethodSelect("terminal")}
            disabled={loading}
            className="flex h-16 items-center justify-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-lg font-medium transition-all hover:border-[var(--color-accent)]/40 disabled:opacity-40"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
              />
            </svg>
            Tap at Front Desk
          </button>

          <button
            onClick={() => handleMethodSelect("online_fallback")}
            disabled={loading}
            className="flex h-16 items-center justify-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-lg font-medium transition-all hover:border-[var(--color-accent)]/40 disabled:opacity-40"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
              />
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

  // Step: amount (default)
  return (
    <div className="flex flex-col gap-8 w-full max-w-sm">
      <div className="text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-green-500/10 px-4 py-1.5 text-sm font-medium text-green-500">
          <svg
            className="h-4 w-4"
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
          Checked in
        </div>
        <h2 className="text-2xl font-bold">Hey {displayName}!</h2>
        <p className="mt-1 text-[var(--color-muted)]">
          Pay what you can for today&apos;s session
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
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
        <div className="relative col-span-2">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[var(--color-muted)]">
            $
          </span>
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Other amount"
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
              handleMethodSelect("skipped");
            } else {
              setStep("method");
            }
          }}
          disabled={loading}
          className="h-14 rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {selectedCents === 0
            ? "Skip Payment"
            : `Continue — $${(selectedCents / 100).toFixed(2)}`}
        </button>
      </div>

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      <button
        onClick={() => {
          clearPendingCheckIn();
          setStep("done");
        }}
        className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)]"
      >
        Skip for now
      </button>
    </div>
  );
}
