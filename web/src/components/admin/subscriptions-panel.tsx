"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ACTIVE_STATUSES } from "@/lib/subscription-sync";
import type { Subscription } from "@/lib/types";

type SubscriptionWithVillager = Subscription & {
  villagers: {
    display_name: string;
    ig_handle: string | null;
    email: string | null;
  } | null;
};

type Group = "active" | "ending" | "pending" | "paused" | "ended";

type SortField = "villager" | "amount" | "interval" | "status" | "updated_at";
type SortDir = "asc" | "desc";

function sortSubscriptions(
  subscriptions: SubscriptionWithVillager[],
  sortBy: SortField,
  sortDir: SortDir
): SubscriptionWithVillager[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...subscriptions].sort((a, b) => {
    switch (sortBy) {
      case "villager":
        return (
          String(a.villagers?.display_name ?? "").localeCompare(
            String(b.villagers?.display_name ?? "")
          ) * dir
        );
      case "amount":
        return (a.amount - b.amount) * dir;
      case "updated_at":
        return (
          (new Date(a.updated_at).getTime() -
            new Date(b.updated_at).getTime()) *
          dir
        );
      default:
        return (
          String(a[sortBy] ?? "").localeCompare(String(b[sortBy] ?? "")) * dir
        );
    }
  });
}

const GROUP_ORDER: Group[] = ["active", "ending", "pending", "paused", "ended"];

const GROUP_FOR_STATUS: Record<string, Group> = {
  active: "active",
  trialing: "active",
  past_due: "active",
  // Initial payment not completed yet — a transient state, not a final one.
  incomplete: "pending",
  paused: "paused",
  canceled: "ended",
  incomplete_expired: "ended",
  unpaid: "ended",
};

const GROUP_LABELS: Record<Group, string> = {
  active: "Active",
  ending: "Ending",
  pending: "Pending",
  paused: "Paused",
  ended: "Ended",
};

const STATUS_STYLES: Record<Group, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  ending:
    "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  pending:
    "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
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

function pickSubscriptionForVillager(
  rows: SubscriptionWithVillager[]
): SubscriptionWithVillager {
  const active = rows.find((s) => ACTIVE_STATUSES.has(s.status));
  if (active) return active;
  return [...rows].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0];
}

function dedupeSubscriptionsByVillager(
  subscriptions: SubscriptionWithVillager[]
): SubscriptionWithVillager[] {
  const byVillager = new Map<string, SubscriptionWithVillager[]>();
  for (const sub of subscriptions) {
    const rows = byVillager.get(sub.villager_id);
    if (rows) rows.push(sub);
    else byVillager.set(sub.villager_id, [sub]);
  }
  return [...byVillager.values()].map(pickSubscriptionForVillager);
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
  const [sortBy, setSortBy] = useState<SortField>("villager");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  }

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

  const handleRefresh = useCallback(async () => {
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
  }, [apiFetch, loadSubscriptions]);

  // On load, show whatever is in the DB immediately, then reconcile from Stripe
  // so the panel always reflects live subscription state without a manual click.
  useEffect(() => {
    (async () => {
      await loadSubscriptions();
      await handleRefresh();
    })();
  }, [loadSubscriptions, handleRefresh]);

  const grouped = useMemo(() => {
    const buckets: Record<Group, SubscriptionWithVillager[]> = {
      active: [],
      ending: [],
      pending: [],
      paused: [],
      ended: [],
    };
    for (const sub of dedupeSubscriptionsByVillager(subscriptions)) {
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
            {grouped.pending.length} pending · {grouped.paused.length} paused ·{" "}
            {grouped.ended.length} ended
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
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
          />
        ))}
    </>
  );
}

const SUB_COLUMNS: { key: SortField; label: string; className?: string }[] = [
  { key: "villager", label: "Villager" },
  { key: "amount", label: "Amount" },
  { key: "interval", label: "Interval" },
  { key: "status", label: "Status" },
  { key: "updated_at", label: "Updated", className: "hidden md:table-cell" },
];

function SubscriptionGroup({
  group,
  subscriptions,
  sortBy,
  sortDir,
  onSort,
}: {
  group: Group;
  subscriptions: SubscriptionWithVillager[];
  sortBy: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const sorted = sortSubscriptions(subscriptions, sortBy, sortDir);
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
              {SUB_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  className={`cursor-pointer select-none px-4 py-3 font-semibold text-[var(--color-muted)] transition hover:text-[var(--color-foreground)] ${col.className ?? ""}`}
                >
                  {col.label}
                  {sortBy !== col.key ? (
                    <span className="ml-1 opacity-30">↕</span>
                  ) : (
                    <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-[var(--color-muted)]"
                >
                  None.
                </td>
              </tr>
            )}
            {sorted.map((sub) => (
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
