"use client";

import { useCallback, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getDeviceId } from "@/lib/device-id";
import type { CardSummary } from "@/lib/card-on-file";
import { exclusiveMonthlyTotalCents } from "@/lib/fees";
import { buildStripeAppearance, stripePromise, useDarkMode } from "@/components/payment-step";

const BRAND_DISPLAY: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
};

export interface CardUpdateResult {
  notice: string | null;
  error: string | null;
  resubscribed: boolean;
}

export type ConfirmedIntent = { setupIntentId: string } | { paymentIntentId: string };

// Shared with the manage page, which finalizes after a 3DS redirect back to it.
export async function finalizeCardUpdate(intent: ConfirmedIntent): Promise<CardUpdateResult> {
  const deviceId = getDeviceId();
  if (!deviceId) return { notice: null, error: "No device found", resubscribed: false };
  try {
    const res = await fetch("/api/subscription/payment-method", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: deviceId,
        ...("setupIntentId" in intent
          ? { setup_intent_id: intent.setupIntentId }
          : { payment_intent_id: intent.paymentIntentId }),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { notice: null, error: data.error || "Could not update card", resubscribed: false };
    }
    if (data.payment_retry_failed) {
      return {
        notice: "Your card was updated.",
        error: "Your overdue payment still didn't go through. Please try a different card.",
        resubscribed: false,
      };
    }
    let notice = "Your card was updated.";
    if (data.resubscribed) notice = "Your card was updated and your support has restarted.";
    else if (data.payment_retried) notice = "Your card was updated and your overdue payment went through.";
    return { notice, error: null, resubscribed: data.resubscribed === true };
  } catch {
    return { notice: null, error: "Could not update card", resubscribed: false };
  }
}

function formatExpiry(card: CardSummary): string {
  return `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`;
}

export function UpdatePaymentMethod({
  card,
  resubscribe,
  onUpdated,
}: {
  card: CardSummary | null;
  // When the pledge has ended, saving the card charges the signup amount and restarts it.
  resubscribe: boolean;
  onUpdated: (result: CardUpdateResult) => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDark = useDarkMode();
  const appearance = useMemo(() => buildStripeAppearance(isDark), [isDark]);
  const totalLabel = `$${(exclusiveMonthlyTotalCents() / 100).toFixed(2)}`;

  const handleStart = useCallback(async () => {
    const deviceId = getDeviceId();
    if (!deviceId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(
        resubscribe ? "/api/create-subscription" : "/api/subscription/payment-method/setup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_id: deviceId }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start card update");
      setClientSecret(data.client_secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start card update");
    } finally {
      setStarting(false);
    }
  }, [resubscribe]);

  const handleDone = useCallback(
    (result: CardUpdateResult) => {
      setClientSecret(null);
      onUpdated(result);
    },
    [onUpdated]
  );

  return (
    <div className="w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
        Payment method
      </p>
      {card ? (
        <p className="mt-1 text-sm">
          <span className="font-medium">{BRAND_DISPLAY[card.brand] ?? card.brand}</span>
          <span className="text-[var(--color-muted)]"> •••• {card.last4}</span>
          {card.expired ? (
            <span className="text-red-500"> · Expired {formatExpiry(card)}</span>
          ) : (
            <span className="text-[var(--color-muted)]"> · Expires {formatExpiry(card)}</span>
          )}
        </p>
      ) : (
        <p className="mt-1 text-sm text-[var(--color-muted)]">No card on file.</p>
      )}
      {resubscribe && (
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Your support has ended. Updating your card restarts it: {totalLabel} is charged today,
          then monthly on the 1st.
        </p>
      )}

      {clientSecret ? (
        <div className="mt-4">
          <Elements
            key={isDark ? "dark-card" : "light-card"}
            stripe={stripePromise}
            options={{ clientSecret, appearance }}
          >
            <UpdateCardForm
              resubscribe={resubscribe}
              submitLabel={resubscribe ? `Pay ${totalLabel} & restart` : "Save card"}
              onDone={handleDone}
              onCancel={() => setClientSecret(null)}
            />
          </Elements>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          disabled={starting}
          className="mt-3 h-12 w-full rounded-xl border border-[var(--color-border)] text-sm font-medium transition hover:border-[var(--color-accent)]/40 disabled:opacity-50"
        >
          {starting ? "…" : resubscribe ? "Update card & restart support" : "Update payment method"}
        </button>
      )}

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}

function UpdateCardForm({
  resubscribe,
  submitLabel,
  onDone,
  onCancel,
}: {
  resubscribe: boolean;
  submitLabel: string;
  onDone: (result: CardUpdateResult) => void;
  onCancel: () => void;
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
      setError(submitError.message || "Could not save card");
      setProcessing(false);
      return;
    }

    const confirmParams = { return_url: `${window.location.origin}/manage` };
    let confirmed: ConfirmedIntent | null = null;
    let confirmError: { message?: string } | undefined;
    if (resubscribe) {
      const result = await stripe.confirmPayment({ elements, confirmParams, redirect: "if_required" });
      confirmError = result.error;
      if (result.paymentIntent) confirmed = { paymentIntentId: result.paymentIntent.id };
    } else {
      const result = await stripe.confirmSetup({ elements, confirmParams, redirect: "if_required" });
      confirmError = result.error;
      if (result.setupIntent) confirmed = { setupIntentId: result.setupIntent.id };
    }

    if (confirmError || !confirmed) {
      setError(confirmError?.message || "Could not save card");
      setProcessing(false);
      return;
    }

    onDone(await finalizeCardUpdate(confirmed));
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      <PaymentElement />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="grid w-full grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={processing}
          className="h-12 rounded-xl border border-[var(--color-border)] text-sm font-medium transition hover:border-[var(--color-accent)]/40 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || processing}
          className="h-12 rounded-xl bg-[var(--color-accent)] text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
        >
          {processing ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
