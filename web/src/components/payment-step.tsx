"use client";

import { useState, useCallback, useMemo, useEffect, useSyncExternalStore } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import type { Appearance } from "@stripe/stripe-js";
import { calcProcessingFee, EXCLUSIVE_SUPPORT_CENTS, exclusiveMonthlyTotalCents } from "@/lib/fees";

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
  // Optional: the recurring (subscribe) flow can run without a check-in, e.g.
  // an exclusive member subscribing from the "check-ins closed" landing page.
  // The one-time flow always has one.
  checkInId?: string | null;
  deviceId: string;
  isExclusive?: boolean;
  isNewRegistration?: boolean;
  onComplete: (paid?: boolean) => void;
}

interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

const PRESET_AMOUNTS = [
  { label: "$ 5", cents: 500 },
];

// Minimum for a one-time custom amount (also the single preset).
const ONE_OFF_MIN_CENTS = 500;

const BILL_COLORS: Record<number, { bg: string; border: string; text: string }> = {
  500:  { bg: "bg-sky-100 dark:bg-sky-950",     border: "border-sky-300 dark:border-sky-700",     text: "text-sky-800 dark:text-sky-200" },
};

const BRAND_DISPLAY: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
};

export function PaymentStep({ checkInId = null, deviceId, isExclusive = false, isNewRegistration = false, onComplete }: PaymentStepProps) {
  // Exclusive villagers commit to a recurring pledge only; everyone else gets
  // the one-time flow. The mode is fixed by tier, so there is no toggle.
  const mode: "once" | "recurring" = isExclusive ? "recurring" : "once";
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [chargingSaved, setChargingSaved] = useState(false);

  // Recurring config (exclusive only): a fixed $10/month support base plus the
  // processing fee, billed monthly.
  const recurringInterval: "week" | "month" = "month";
  const exclusiveSupportCents = EXCLUSIVE_SUPPORT_CENTS;
  const exclusiveFeeCents = calcProcessingFee(EXCLUSIVE_SUPPORT_CENTS);
  const recurringChargeCents = exclusiveMonthlyTotalCents();
  const [subClientSecret, setSubClientSecret] = useState<string | null>(null);

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
    if (cents < ONE_OFF_MIN_CENTS) {
      setError("Minimum payment amount is $5");
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

  const handleRecurringSetup = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: recurringChargeCents, interval: recurringInterval, device_id: deviceId, check_in_id: checkInId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to set up subscription");
      setSubClientSecret(data.client_secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [recurringChargeCents, recurringInterval, deviceId, checkInId]);

  const handleBackFromRecurring = useCallback(() => {
    setSubClientSecret(null);
    setError(null);
  }, []);

  if (subClientSecret) {
    return (
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h2 className="text-4xl font-bold font-[family-name:var(--font-domaine)]">
          ${(recurringChargeCents / 100).toFixed(2)}/month
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          ${(exclusiveSupportCents / 100).toFixed(2)} support + ${(exclusiveFeeCents / 100).toFixed(2)} required processing fee. Cancel anytime.
        </p>
        <Elements
          key={isDark ? "dark-sub" : "light-sub"}
          stripe={stripePromise}
          options={{ clientSecret: subClientSecret, appearance }}
        >
          <CheckoutForm
            checkInId={checkInId}
            totalCents={recurringChargeCents}
            onComplete={onComplete}
            recurringInterval={recurringInterval}
            isNewRegistration={isNewRegistration}
          />
        </Elements>
        <button
          type="button"
          onClick={handleBackFromRecurring}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
        >
          &larr; Back
        </button>
      </div>
    );
  }

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
          <CheckoutForm checkInId={checkInId} totalCents={amountInCents + calcProcessingFee(amountInCents)} onComplete={onComplete} isNewRegistration={isNewRegistration} />
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

      {mode === "once" && (
      <div className="contents">
      <div className="grid w-full grid-cols-1 gap-3">
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
            min="5"
            step="0.01"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
          />
          <button
            onClick={handleCustomConfirm}
            disabled={loading || !customAmount || parseFloat(customAmount) < 5}
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
      </div>
      )}

      {mode === "recurring" && (
      <div className="contents">
        {(() => {
          const bill = BILL_COLORS[500];
          return (
            <div className="grid w-full grid-cols-1 gap-3">
              <div
                className={`rounded-lg border px-3 py-5 text-2xl font-bold font-[family-name:var(--font-domaine)] ${bill.border} ${bill.bg} ${bill.text} ring-2 ring-[var(--color-accent)]/40`}
              >
                $ {(exclusiveSupportCents / 100).toFixed(2)}
                <span className="text-base font-medium"> / mo</span>
              </div>
            </div>
          );
        })()}

        <div className="w-full space-y-1 text-sm text-[var(--color-muted)]">
          <div className="flex items-center justify-between">
            <span>${(exclusiveSupportCents / 100).toFixed(2)} support</span>
            <span>${(exclusiveSupportCents / 100).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>+ Required processing fee</span>
            <span>${(exclusiveFeeCents / 100).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-1 font-medium text-[var(--color-foreground)]">
            <span>Billed monthly</span>
            <span>${(recurringChargeCents / 100).toFixed(2)}</span>
          </div>
          <p className="pt-2 text-left text-xs">
            The processing fee covers the card processor&apos;s cost so your full ${(exclusiveSupportCents / 100).toFixed(2)} goes to the Village. Cancel anytime.
          </p>
        </div>

        <button
          onClick={handleRecurringSetup}
          disabled={loading}
          className="h-14 w-full rounded-2xl bg-[var(--color-accent)] px-4 text-lg font-semibold font-[family-name:var(--font-domaine)] text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
        >
          {loading ? "Setting up..." : "Subscribe"}
        </button>
      </div>
      )}

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {loading && !selectedAmount && (
        <p className="text-sm text-[var(--color-muted)]">Setting up payment...</p>
      )}
    </div>
  );
}

function CheckoutForm({
  checkInId,
  totalCents,
  onComplete,
  recurringInterval,
  isNewRegistration = false,
}: {
  checkInId?: string | null;
  totalCents: number;
  onComplete: (paid?: boolean) => void;
  recurringInterval?: "week" | "month";
  isNewRegistration?: boolean;
}) {
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

    // A 3DS redirect should return to the success page. The check-in id is
    // included when present (the subscribe-without-checkin path has none).
    const returnUrl = `${window.location.origin}/success?${[
      checkInId ? `check_in_id=${checkInId}` : null,
      isNewRegistration ? "new=1" : null,
    ]
      .filter(Boolean)
      .join("&")}`;

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message || "Payment failed");
      setProcessing(false);
    } else {
      onComplete(true);
    }
  }

  const label = recurringInterval
    ? `Support $${(totalCents / 100).toFixed(2)}/${recurringInterval === "week" ? "wk" : "mo"}`
    : `Pay — $${(totalCents / 100).toFixed(2)}`;

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      <PaymentElement />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || processing}
        className="h-14 w-full rounded-2xl bg-[var(--color-accent)] px-4 text-lg font-semibold font-[family-name:var(--font-domaine)] text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
      >
        {processing ? "Processing..." : label}
      </button>
    </form>
  );
}
