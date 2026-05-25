"use client";

import { useState, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface PaymentStepProps {
  checkInId: string;
  displayName: string;
  onComplete: () => void;
}

const PRESET_AMOUNTS = [
  { label: "Broke Artist", cents: 0 },
  { label: "$5", cents: 500 },
  { label: "$10", cents: 1000 },
  { label: "$15", cents: 1500 },
  { label: "$20", cents: 2000 },
];

export function PaymentStep({ checkInId, displayName, onComplete }: PaymentStepProps) {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleBrokeArtist = useCallback(() => {
    onComplete();
  }, [onComplete]);

  if (selectedAmount === 0 && !useCustom) {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10">
          <svg className="h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold">No worries, {displayName}!</h2>
        <p className="text-[var(--color-muted)]">
          The Village is for everyone. Enjoy your session.
        </p>
        <button
          onClick={handleBrokeArtist}
          className="mt-2 rounded-lg bg-[var(--color-accent)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)]"
        >
          Continue
        </button>
      </div>
    );
  }

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
        <h2 className="text-xl font-bold">
          Pay What You Can — ${(amountInCents / 100).toFixed(2)}
        </h2>
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: "flat",
              variables: {
                colorPrimary: "#dc2626",
                fontFamily: "inherit",
              },
            },
          }}
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
      <h2 className="text-2xl font-bold">Pay What You Can</h2>
      <p className="text-sm text-[var(--color-muted)]">
        Support the Village. Every little bit helps — or don&apos;t. No judgment.
      </p>

      <div className="grid w-full grid-cols-3 gap-2">
        {PRESET_AMOUNTS.map((preset) => (
          <button
            key={preset.cents}
            onClick={() => preset.cents === 0 ? handleAmountSelect(0) : handleAmountSelect(preset.cents)}
            disabled={loading}
            className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
              selectedAmount === preset.cents && !useCustom
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                : "border-[var(--color-border)] hover:border-[var(--color-accent)]/50"
            } disabled:opacity-50`}
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => { setUseCustom(true); setSelectedAmount(null); setClientSecret(null); }}
          disabled={loading}
          className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
            useCustom
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
              : "border-[var(--color-border)] hover:border-[var(--color-accent)]/50"
          } disabled:opacity-50`}
        >
          Custom
        </button>
      </div>

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
        onClick={onComplete}
        className="mt-2 text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
      >
        Skip for now
      </button>
    </div>
  );
}

function CheckoutForm({ checkInId, onComplete }: { checkInId: string; onComplete: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      setSuccess(true);
      setTimeout(onComplete, 1500);
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
          <svg className="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-semibold text-green-600">Payment successful!</p>
      </div>
    );
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
        onClick={onComplete}
        className="w-full text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
      >
        Skip for now
      </button>
    </form>
  );
}
