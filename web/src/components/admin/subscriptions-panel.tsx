"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Subscription } from "@/lib/types";

type SubscriptionWithVillager = Subscription & {
  villagers: {
    display_name: string;
    ig_handle: string | null;
    email: string | null;
  } | null;
};

type Group = "active" | "ending" | "paused" | "ended";

const GROUP_ORDER: Group[] = ["active", "ending", "paused", "ended"];

const GROUP_FOR_STATUS: Record<string, Group> = {
  active: "active",
  trialing: "active",
  past_due: "active",
  paused: "paused",
  canceled: "ended",
  incomplete_expired: "ended",
  unpaid: "ended",
  incomplete: "ended",
};

const GROUP_LABELS: Record<Group, string> = {
  active: "Active",
  ending: "Ending",
  paused: "Paused",
  ended: "Ended",
};

const STATUS_STYLES: Record<Group, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  ending:
    "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  paused:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  ended: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

// A pledge still in an active status but set to cancel at period end is winding
// down: the member keeps access until the period ends, so it's shown apart from
// fully-active pledges.
function groupForSubscription(sub: SubscriptionWithVillager): Group {
  const base = GROUP_FOR_STATUS[sub.status] ?? "ended";
  if (base === "active" && sub.cancel_at_period_end) return "ending";
  return base;
}

function formatCents(cents: number): string {
  if (cents === 0) return "$0";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SubscriptionsPanel({ token }: { token: string }) {
  const [subscriptions, setSubscriptions] = useState<
    SubscriptionWithVillager[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");

  const apiFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      return fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...options.headers,
        },
      });
    },
    [token]
  );

  const loadSubscriptions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/subscriptions");
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to load subscriptions");
      }
      const { subscriptions } = await res.json();
      setSubscriptions(subscriptions);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshMessage("");
    setError("");
    try {
      const res = await apiFetch("/api/admin/subscriptions/refresh", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      setRefreshMessage(
        `Reconciled ${data.synced} subscriptions from Stripe${data.failed ? ` (${data.failed} failed)` : ""}.`
      );
      await loadSubscriptions();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const grouped = useMemo(() => {
    const buckets: Record<Group, SubscriptionWithVillager[]> = {
      active: [],
      ending: [],
      paused: [],
      ended: [],
    };
    for (const sub of subscriptions) {
      buckets[groupForSubscription(sub)].push(sub);
    }
    return buckets;
  }, [subscriptions]);

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Subscriptions</h2>
          <p className="text-sm text-[var(--color-muted)]">
            {grouped.active.length} active · {grouped.ending.length} ending ·{" "}
            {grouped.paused.length} paused · {grouped.ended.length} ended
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-foreground)] disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh from Stripe"}
        </button>
      </div>

      {refreshMessage && (
        <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {refreshMessage}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
          <button
            onClick={() => setError("")}
            className="ml-3 font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-[var(--color-border)] px-4 py-12 text-center text-[var(--color-muted)]">
          Loading…
        </div>
      )}

      {!loading &&
        GROUP_ORDER.map((group) => (
          <SubscriptionGroup
            key={group}
            group={group}
            subscriptions={grouped[group]}
          />
        ))}
    </>
  );
}

function SubscriptionGroup({
  group,
  subscriptions,
}: {
  group: Group;
  subscriptions: SubscriptionWithVillager[];
}) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-muted)]">
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[group]}`}
        >
          {GROUP_LABELS[group]}
        </span>
        <span>{subscriptions.length}</span>
      </h3>
      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
              <th className="px-4 py-3 font-semibold text-[var(--color-muted)]">
                Villager
              </th>
              <th className="px-4 py-3 font-semibold text-[var(--color-muted)]">
                Amount
              </th>
              <th className="px-4 py-3 font-semibold text-[var(--color-muted)]">
                Interval
              </th>
              <th className="px-4 py-3 font-semibold text-[var(--color-muted)]">
                Status
              </th>
              <th className="hidden px-4 py-3 font-semibold text-[var(--color-muted)] md:table-cell">
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-[var(--color-muted)]"
                >
                  None.
                </td>
              </tr>
            )}
            {subscriptions.map((sub) => (
              <tr
                key={sub.id}
                className="border-b border-[var(--color-border)] transition hover:bg-[var(--color-surface)]"
              >
                <td className="px-4 py-3 font-medium">
                  {sub.villagers?.display_name || "Unknown"}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatCents(sub.amount)}
                </td>
                <td className="px-4 py-3 text-[var(--color-muted)]">
                  {sub.interval === "week" ? "Weekly" : "Monthly"}
                </td>
                <td className="px-4 py-3 text-[var(--color-muted)]">
                  <span className="font-mono text-xs">{sub.status}</span>
                  {sub.cancel_at_period_end && (
                    <span className="mt-0.5 block text-xs text-orange-600 dark:text-orange-400">
                      cancels at period end
                    </span>
                  )}
                </td>
                <td className="hidden px-4 py-3 text-[var(--color-muted)] md:table-cell">
                  {formatDate(sub.updated_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
