"use client";

import { useState, useCallback, useMemo, useEffect, useSyncExternalStore } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import type { Appearance } from "@stripe/stripe-js";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

const darkModeQuery = "(prefers-color-scheme: dark)";

function subscribeDarkMode(callback: () => void) {
  const mq = window.matchMedia(darkModeQuery);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getSnapshotDarkMode() {
  return window.matchMedia(darkModeQuery).matches;
}

function useDarkMode() {
  return useSyncExternalStore(subscribeDarkMode, getSnapshotDarkMode, () => false);
}

function buildStripeAppearance(isDark: boolean): Appearance {
  return {
    theme: isDark ? "night" : "flat",
    variables: {
      colorPrimary: isDark ? "#ef4444" : "#dc2626",
      colorBackground: isDark ? "#0a0a0a" : "#ffffff",
      colorText: isDark ? "#f0f0f0" : "#1a1a1a",
      colorTextSecondary: isDark ? "#9ca3af" : "#6b7280",
      colorDanger: "#ef4444",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
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
        backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
      },
      ".Tab--selected": {
        border: `1px solid ${isDark ? "#ef4444" : "#dc2626"}`,
        backgroundColor: isDark ? "#141414" : "#fafafa",
      },
      ".Tab:hover": {
        border: `1px solid ${isDark ? "#ef4444" : "#dc2626"}`,
      },
    },
  };
}

interface PaymentStepProps {
  checkInId: string;
  deviceId: string;
  onComplete: (paid?: boolean) => void;
}

interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

function calcProcessingFee(cents: number): number {
  return Math.ceil((cents + 30) / (1 - 0.029)) - cents;
}

const PRESET_AMOUNTS = [
  { label: "$ 5", cents: 500 },
  { label: "$ 10", cents: 1000 },
  { label: "$ 20", cents: 2000 },
];

const BILL_COLORS: Record<number, { bg: string; border: string; text: string }> = {
  500:  { bg: "bg-sky-100 dark:bg-sky-950",     border: "border-sky-300 dark:border-sky-700",     text: "text-sky-800 dark:text-sky-200" },
  1000: { bg: "bg-purple-100 dark:bg-purple-950", border: "border-purple-300 dark:border-purple-700", text: "text-purple-800 dark:text-purple-200" },
  2000: { bg: "bg-emerald-100 dark:bg-emerald-950", border: "border-emerald-300 dark:border-emerald-700", text: "text-emerald-800 dark:text-emerald-200" },
};

const BRAND_DISPLAY: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
};

export function PaymentStep({ checkInId, deviceId, onComplete }: PaymentStepProps) {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [chargingSaved, setChargingSaved] = useState(false);

  const isDark = useDarkMode();
  const appearance = useMemo(() => buildStripeAppearance(isDark), [isDark]);

  useEffect(() => {
    fetch(`/api/payment-methods?device_id=${encodeURIComponent(deviceId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.methods?.length) setSavedCards(data.methods);
      })
      .catch(() => {});
  }, [deviceId]);

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
        body: JSON.stringify({ amount: cents, check_in_id: checkInId, device_id: deviceId }),
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
  }, [checkInId, deviceId]);

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
        body: JSON.stringify({ amount: cents, check_in_id: checkInId, device_id: deviceId }),
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
  }, [customAmount, checkInId, deviceId]);

  const handleSavedCardPayment = useCallback(async (card: SavedCard, cents: number) => {
    setChargingSaved(true);
    setError(null);
    try {
      const res = await fetch("/api/charge-saved-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: cents,
          check_in_id: checkInId,
          device_id: deviceId,
          payment_method_id: card.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment failed");
      if (data.status === "succeeded") {
        onComplete(true);
      } else {
        throw new Error("Payment requires additional action. Please use a new card.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setChargingSaved(false);
    }
  }, [checkInId, deviceId, onComplete]);

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
        <p className="text-xs text-[var(--color-muted)]">
          + ${(calcProcessingFee(amountInCents) / 100).toFixed(2)} payment processor fee
        </p>
        <Elements
          key={isDark ? "dark" : "light"}
          stripe={stripePromise}
          options={{ clientSecret, appearance }}
        >
          <CheckoutForm checkInId={checkInId} totalCents={amountInCents + calcProcessingFee(amountInCents)} onComplete={onComplete} />
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
              onClick={() => {
                setSelectedAmount(preset.cents);
                setUseCustom(false);
                setError(null);
              }}
              disabled={loading || chargingSaved}
              className={`rounded-lg border px-3 py-5 text-2xl font-bold font-[family-name:var(--font-domaine)] transition ${
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
        disabled={loading || chargingSaved}
        className={`w-full rounded-lg border px-3 py-4 text-xl font-medium font-[family-name:var(--font-domaine)] transition ${
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
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold font-[family-name:var(--font-domaine)] text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
          >
            {loading ? "..." : "Go"}
          </button>
        </div>
      )}

      {/* Fee note when an amount is selected */}
      {selectedAmount && !useCustom && (
        <p className="text-xs text-[var(--color-muted)]">
          + ${(calcProcessingFee(selectedAmount) / 100).toFixed(2)} payment processor fee
        </p>
      )}

      {/* Saved card one-tap payment — only show when an amount is selected */}
      {savedCards.length > 0 && selectedAmount && !useCustom && (
        <div className="w-full space-y-2">
          {savedCards.map((card) => (
            <button
              key={card.id}
              onClick={() => handleSavedCardPayment(card, selectedAmount)}
              disabled={chargingSaved || loading}
              className="flex w-full items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm transition hover:border-[var(--color-accent)]/50 disabled:opacity-50"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium">{BRAND_DISPLAY[card.brand] ?? card.brand}</span>
                <span className="text-[var(--color-muted)]">•••• {card.last4}</span>
              </span>
              <span className="font-semibold text-[var(--color-accent)]">
                {chargingSaved ? "Paying..." : `Pay $${((selectedAmount + calcProcessingFee(selectedAmount)) / 100).toFixed(2)}`}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* New card option when an amount is selected and saved cards exist */}
      {savedCards.length > 0 && selectedAmount && !useCustom && (
        <button
          onClick={() => handleAmountSelect(selectedAmount)}
          disabled={loading || chargingSaved}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
        >
          Use a new card instead
        </button>
      )}

      {/* Direct proceed when no saved cards and an amount is selected */}
      {savedCards.length === 0 && selectedAmount && !useCustom && (
        <button
          onClick={() => handleAmountSelect(selectedAmount)}
          disabled={loading}
          className="h-14 w-full rounded-2xl bg-[var(--color-accent)] px-4 text-lg font-semibold font-[family-name:var(--font-domaine)] text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
        >
          {loading ? "Setting up..." : `Pay $${((selectedAmount + calcProcessingFee(selectedAmount)) / 100).toFixed(2)}`}
        </button>
      )}

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {loading && !selectedAmount && (
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

function CheckoutForm({ checkInId, totalCents, onComplete }: { checkInId: string; totalCents: number; onComplete: (paid?: boolean) => void }) {
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
        className="h-14 w-full rounded-2xl bg-[var(--color-accent)] px-4 text-lg font-semibold font-[family-name:var(--font-domaine)] text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
      >
        {processing ? "Processing..." : `Pay — $${(totalCents / 100).toFixed(2)}`}
      </button>
    </form>
  );
}
