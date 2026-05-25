"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import type { Appearance } from "@stripe/stripe-js";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function useStripeAppearance(): Appearance {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return useMemo<Appearance>(() => ({
    theme: "flat",
    variables: {
      colorPrimary: isDark ? "#ef4444" : "#dc2626",
      colorBackground: isDark ? "#141414" : "#fafafa",
      colorText: isDark ? "#f0f0f0" : "#1a1a1a",
      colorTextSecondary: isDark ? "#9ca3af" : "#6b7280",
      colorDanger: "#ef4444",
      fontFamily: "var(--font-geist), ui-sans-serif, system-ui, sans-serif",
      fontSizeBase: "14px",
      borderRadius: "8px",
      spacingUnit: "4px",
    },
    rules: {
      ".Input": {
        border: `1px solid ${isDark ? "#262626" : "#e5e7eb"}`,
        backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
        boxShadow: "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
      },
      ".Input:focus": {
        border: `1px solid ${isDark ? "#ef4444" : "#dc2626"}`,
        boxShadow: `0 0 0 3px ${isDark ? "rgba(239,68,68,0.25)" : "rgba(220,38,38,0.25)"}`,
      },
      ".Label": {
        color: isDark ? "#9ca3af" : "#6b7280",
        fontWeight: "500",
        fontSize: "13px",
      },
      ".Tab": {
        border: `1px solid ${isDark ? "#262626" : "#e5e7eb"}`,
        backgroundColor: isDark ? "#141414" : "#fafafa",
      },
      ".Tab--selected": {
        border: `1px solid ${isDark ? "#ef4444" : "#dc2626"}`,
        backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
      },
      ".Tab:hover": {
        border: `1px solid ${isDark ? "#ef4444" : "#dc2626"}`,
      },
    },
  }), [isDark]);
}

interface PaymentStepProps {
  checkInId: string;
  onComplete: (paid?: boolean) => void;
}

const PRESET_AMOUNTS = [
  { label: "$5", cents: 500 },
  { label: "$10", cents: 1000 },
  { label: "$20", cents: 2000 },
];

const BILL_COLORS: Record<number, { bg: string; border: string; text: string }> = {
  500:  { bg: "bg-sky-100 dark:bg-sky-950",     border: "border-sky-300 dark:border-sky-700",     text: "text-sky-800 dark:text-sky-200" },
  1000: { bg: "bg-purple-100 dark:bg-purple-950", border: "border-purple-300 dark:border-purple-700", text: "text-purple-800 dark:text-purple-200" },
  2000: { bg: "bg-emerald-100 dark:bg-emerald-950", border: "border-emerald-300 dark:border-emerald-700", text: "text-emerald-800 dark:text-emerald-200" },
};

export function PaymentStep({ checkInId, onComplete }: PaymentStepProps) {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appearance = useStripeAppearance();

  const amountInCents = useCustom
    ? Math.round(parseFloat(customAmount || "0") * 100)
    : (selectedAmount ?? 0);

  const handleAmountSelect = useCallback(async (cents: number) => {
    setSelectedAmount(cents);
    setUseCustom(false);
    setError(null);

    if (cents === 0) return;

    setLoading(true);
    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: cents, check_in_id: checkInId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to initialize payment");
      }
      const { client_secret } = await res.json();
      setClientSecret(client_secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [checkInId]);

  const handleCustomConfirm = useCallback(async () => {
    const cents = Math.round(parseFloat(customAmount || "0") * 100);
    if (cents < 50) {
      setError("Minimum payment amount is $0.50");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: cents, check_in_id: checkInId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to initialize payment");
      }
      const { client_secret } = await res.json();
      setClientSecret(client_secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [customAmount, checkInId]);

  const handleBackToAmounts = useCallback(() => {
    setClientSecret(null);
    setSelectedAmount(null);
    setUseCustom(false);
    setCustomAmount("");
    setError(null);
  }, []);

  if (clientSecret) {
    return (
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h2 className="text-4xl font-bold font-[family-name:var(--font-domaine)]">
          Support the Village! — ${(amountInCents / 100).toFixed(2)}
        </h2>
        <Elements
          stripe={stripePromise}
          options={{ clientSecret, appearance }}
        >
          <CheckoutForm checkInId={checkInId} onComplete={onComplete} />
        </Elements>
        <button
          type="button"
          onClick={handleBackToAmounts}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
        >
          &larr; Change amount
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <h2 className="text-4xl font-bold font-[family-name:var(--font-domaine)]">Support the Village!</h2>
      <p className="text-sm text-[var(--color-muted)]">
        Every little bit helps — the Village is for everyone, no matter what.
      </p>

      <div className="grid w-full grid-cols-3 gap-3">
        {PRESET_AMOUNTS.map((preset) => {
          const colors = BILL_COLORS[preset.cents];
          const isSelected = selectedAmount === preset.cents && !useCustom;
          return (
            <button
              key={preset.cents}
              onClick={() => handleAmountSelect(preset.cents)}
              disabled={loading}
              className={`rounded-lg border px-3 py-4 text-base font-bold transition ${
                isSelected
                  ? `${colors.border} ${colors.bg} ${colors.text} ring-2 ring-[var(--color-accent)]/40`
                  : `${colors.border} ${colors.bg} ${colors.text} hover:opacity-80`
              } disabled:opacity-50`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => { setUseCustom(true); setSelectedAmount(null); setClientSecret(null); }}
        disabled={loading}
        className={`w-full rounded-lg border px-3 py-3 text-sm font-medium transition ${
          useCustom
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
            : "border-[var(--color-border)] hover:border-[var(--color-accent)]/50"
        } disabled:opacity-50`}
      >
        Custom Amount
      </button>

      {useCustom && (
        <div className="flex w-full items-center gap-2">
          <span className="text-lg font-medium">$</span>
          <input
            type="number"
            min="0.50"
            step="0.01"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
          />
          <button
            onClick={handleCustomConfirm}
            disabled={loading || !customAmount || parseFloat(customAmount) < 0.5}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
          >
            {loading ? "..." : "Go"}
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {loading && (
        <p className="text-sm text-[var(--color-muted)]">Setting up payment...</p>
      )}

      <button
        onClick={() => onComplete()}
        className="mt-2 text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
      >
        Broke Artist
      </button>
    </div>
  );
}

function CheckoutForm({ checkInId, onComplete }: { checkInId: string; onComplete: (paid?: boolean) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || "Payment failed");
      setProcessing(false);
      return;
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/success?check_in_id=${checkInId}`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message || "Payment failed");
      setProcessing(false);
    } else {
      onComplete(true);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      <PaymentElement />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
      >
        {processing ? "Processing..." : "Pay"}
      </button>
      <button
        type="button"
        onClick={() => onComplete()}
        className="w-full text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
      >
        Skip for now
      </button>
    </form>
  );
}
