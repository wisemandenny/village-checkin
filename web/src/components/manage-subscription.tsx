"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getDeviceId } from "@/lib/device-id";
import type { SubscriptionInterval } from "@/lib/types";

interface ManageSubscriptionData {
  stripe_subscription_id: string;
  amount: number;
  interval: SubscriptionInterval;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: number | null;
}

interface SubscriptionResponse {
  is_exclusive: boolean;
  subscription: ManageSubscriptionData | null;
}

const EXCLUSIVE_MIN_DOLLARS = 10;

function formatDate(unixSeconds: number | null): string | null {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function intervalLabel(interval: SubscriptionInterval): string {
  return interval === "week" ? "week" : "month";
}

export function ManageSubscription() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExclusive, setIsExclusive] = useState(false);
  const [sub, setSub] = useState<ManageSubscriptionData | null>(null);

  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // Fetches the current subscription state. All setState calls happen after an
  // await so this is safe to invoke from the mount effect (no synchronous
  // cascading renders). Throws on failure so callers can surface the error.
  const reload = useCallback(async () => {
    const deviceId = getDeviceId();
    if (!deviceId) return;
    const res = await fetch(
      `/api/subscription?device_id=${encodeURIComponent(deviceId)}`
    );
    if (!res.ok) throw new Error("Could not load your subscription");
    const data: SubscriptionResponse = await res.json();
    setIsExclusive(data.is_exclusive);
    setSub(data.subscription);
    if (data.subscription) {
      setAmount((data.subscription.amount / 100).toFixed(2));
    }
  }, []);

  useEffect(() => {
    if (!getDeviceId()) {
      Promise.resolve().then(() => setLoading(false));
      return;
    }
    (async () => {
      try {
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const deviceId = getDeviceId();
      if (!deviceId) throw new Error("No device found");
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      return data;
    },
    []
  );

  const handleUpdate = useCallback(async () => {
    const cents = Math.round(parseFloat(amount || "0") * 100);
    if (cents < EXCLUSIVE_MIN_DOLLARS * 100) {
      setError(`Minimum amount is $${EXCLUSIVE_MIN_DOLLARS}`);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await post("/api/subscription/update", { amount: cents });
      setNotice("Your support amount has been updated.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update amount");
    } finally {
      setBusy(false);
    }
  }, [amount, post, reload]);

  const handleCancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await post("/api/subscription/cancel", {});
      setConfirmingCancel(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  }, [post, reload]);

  const handleResume = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await post("/api/subscription/resume", {});
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resume");
    } finally {
      setBusy(false);
    }
  }, [post, reload]);

  if (loading) {
    return (
      <p className="text-sm text-[var(--color-muted)]">Loading your support…</p>
    );
  }

  if (!sub) {
    return (
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-bold font-[family-name:var(--font-domaine)]">
          Manage your support
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          You don&apos;t have an active recurring pledge right now.
        </p>
        <Link
          href="/"
          className="text-sm text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-accent-light)]"
        >
          &larr; Back to check-in
        </Link>
      </div>
    );
  }

  const periodEnd = formatDate(sub.current_period_end);
  const pendingCancel = sub.cancel_at_period_end;
  const amountChanged = Math.round(parseFloat(amount || "0") * 100) !== sub.amount;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <h1 className="text-3xl font-bold font-[family-name:var(--font-domaine)]">
        Manage your support
      </h1>

      <div className="w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <p className="text-4xl font-bold font-[family-name:var(--font-domaine)]">
          ${(sub.amount / 100).toFixed(2)}
          <span className="text-lg font-medium text-[var(--color-muted)]">
            {" "}
            / {intervalLabel(sub.interval)}
          </span>
        </p>
        {pendingCancel ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Your support ends{periodEnd ? ` on ${periodEnd}` : " at the end of this period"}.
          </p>
        ) : (
          periodEnd && (
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              Next charge on {periodEnd}.
            </p>
          )
        )}
      </div>

      {pendingCancel ? (
        <button
          type="button"
          onClick={handleResume}
          disabled={busy}
          className="h-14 w-full rounded-2xl bg-[var(--color-accent)] px-4 text-lg font-semibold font-[family-name:var(--font-domaine)] text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
        >
          {busy ? "…" : "Keep my support"}
        </button>
      ) : (
        <>
          {isExclusive && (
            <div className="flex w-full flex-col gap-3">
              <label className="text-sm font-medium text-[var(--color-muted)] text-left">
                Change your monthly amount (minimum ${EXCLUSIVE_MIN_DOLLARS})
              </label>
              <div className="flex w-full items-center gap-2">
                <span className="text-lg font-medium">$</span>
                <input
                  type="number"
                  min={EXCLUSIVE_MIN_DOLLARS}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-12 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-4 text-lg outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
                />
                <span className="text-sm text-[var(--color-muted)]">/ mo</span>
              </div>
              <button
                type="button"
                onClick={handleUpdate}
                disabled={busy || !amountChanged}
                className="h-14 w-full rounded-2xl bg-[var(--color-accent)] px-4 text-lg font-semibold font-[family-name:var(--font-domaine)] text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
              >
                {busy ? "Updating…" : "Update amount"}
              </button>
            </div>
          )}

          {confirmingCancel ? (
            <div className="flex w-full flex-col gap-3">
              <p className="text-sm text-[var(--color-muted)]">
                Cancel your support? You&apos;ll keep it until
                {periodEnd ? ` ${periodEnd}` : " the end of the current period"}.
              </p>
              <div className="grid w-full grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={busy}
                  className="h-12 rounded-xl border border-[var(--color-border)] text-sm font-medium transition hover:border-[var(--color-accent)]/40 disabled:opacity-50"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={busy}
                  className="h-12 rounded-xl border border-red-500/40 text-sm font-medium text-red-500 transition hover:bg-red-500/10 disabled:opacity-50"
                >
                  {busy ? "Cancelling…" : "Cancel support"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              disabled={busy}
              className="text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-red-500 disabled:opacity-50"
            >
              Cancel support
            </button>
          )}
        </>
      )}

      {notice && <p className="text-sm text-green-600 dark:text-green-400">{notice}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      <Link
        href="/"
        className="text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
      >
        &larr; Back to check-in
      </Link>
    </div>
  );
}
