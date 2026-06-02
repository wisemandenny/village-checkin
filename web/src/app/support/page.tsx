"use client";

import { useState } from "react";

type Interval = "week" | "month";

const SUGGESTED: Record<Interval, number> = { week: 5, month: 15 };

export default function SupportPage() {
  const [email, setEmail] = useState("");
  const [interval, setInterval] = useState<Interval>("month");
  const [amount, setAmount] = useState(String(SUGGESTED.month));
  const [customized, setCustomized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectInterval(next: Interval) {
    setInterval(next);
    if (!customized) setAmount(String(SUGGESTED[next]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount || "0") * 100);
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    if (cents < 50) {
      setError("Minimum amount is $0.50.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/create-subscription-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), amount: cents, interval }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("Could not start checkout");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold font-[family-name:var(--font-domaine)]">
            Support the Village
          </h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Set up a recurring contribution — pay what you can. Cancel anytime.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="support-email" className="text-sm font-medium text-[var(--color-muted)]">
            Email
          </label>
          <input
            id="support-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-[var(--color-muted)]">How often?</span>
          <div className="grid grid-cols-2 gap-2">
            {(["week", "month"] as Interval[]).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectInterval(i)}
                className={`h-12 rounded-xl border text-base font-medium transition-all font-[family-name:var(--font-domaine)] ${
                  interval === i
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-accent)]/40"
                }`}
              >
                {i === "week" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="support-amount" className="text-sm font-medium text-[var(--color-muted)]">
            Amount (suggested ${SUGGESTED[interval]}/{interval === "week" ? "week" : "month"})
          </label>
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium">$</span>
            <input
              id="support-amount"
              type="number"
              min="0.50"
              step="0.01"
              value={amount}
              onChange={(e) => {
                setCustomized(true);
                setAmount(e.target.value);
              }}
              className="h-12 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
              required
            />
            <span className="text-sm text-[var(--color-muted)]">/ {interval === "week" ? "wk" : "mo"}</span>
          </div>
        </div>

        {error && <p className="text-sm text-red-500 text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading || !email.trim()}
          className="h-14 rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed font-[family-name:var(--font-domaine)]"
        >
          {loading ? "Redirecting…" : "Continue to checkout"}
        </button>
      </form>
    </main>
  );
}
