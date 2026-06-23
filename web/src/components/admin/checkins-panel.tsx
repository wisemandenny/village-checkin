"use client";

import { useState, useEffect, useCallback, useMemo, FormEvent } from "react";
import type { CheckIn, PaymentMethod, CheckInStatus, Villager } from "@/lib/types";

type CheckInWithVillager = CheckIn & {
  villagers: { display_name: string } | null;
};

type ModalMode = "create" | "edit" | null;

const PAYMENT_METHODS: PaymentMethod[] = [
  "terminal",
  "online_fallback",
  "cash",
  "skipped",
  "subscription",
];
const STATUSES: CheckInStatus[] = ["pending", "paid", "skipped"];

interface CheckInForm {
  villager_id: string;
  intent_amount: string;
  payment_method: PaymentMethod;
  status: CheckInStatus;
  created_at: string;
  stripe_transaction_id: string;
}

const EMPTY_FORM: CheckInForm = {
  villager_id: "",
  intent_amount: "0",
  payment_method: "cash",
  status: "paid",
  created_at: "",
  stripe_transaction_id: "",
};

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

function formatCents(cents: number): string {
  if (cents === 0) return "$0";
  return `$${(cents / 100).toFixed(2)}`;
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(val: string): string {
  if (!val) return "";
  return new Date(val).toISOString();
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  terminal: "Terminal",
  online_fallback: "Online",
  cash: "Cash",
  skipped: "Skipped",
  deferred: "Deferred",
  subscription: "Subscription",
};

const STATUS_STYLES: Record<CheckInStatus, string> = {
  paid: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  pending:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  skipped:
    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

/**
 * Map any check-in timestamp to the Monday of its week.
 * Special case: Tue 12am–4am rolls back to the previous Monday (late session).
 */
function toMondayOfWeek(iso: string): string {
  const d = new Date(iso);
  const day = d.getDay(); // 0=Sun..6=Sat
  const hour = d.getHours();

  if (day === 2 && hour < 4) {
    d.setDate(d.getDate() - 1);
  } else {
    const offset = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - offset);
  }

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface StreakResult {
  current: number;
  currentStart: string | null;
  best: number;
  bestStart: string | null;
  bestEnd: string | null;
  bestIsCurrent: boolean;
}

function formatMD(mondayKey: string): string {
  const d = new Date(mondayKey + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function computeStreaks(checkins: { created_at: string }[]): StreakResult {
  const empty: StreakResult = { current: 0, currentStart: null, best: 0, bestStart: null, bestEnd: null, bestIsCurrent: false };
  if (checkins.length === 0) return empty;

  const mondaySet = new Set<string>();
  for (const c of checkins) {
    mondaySet.add(toMondayOfWeek(c.created_at));
  }

  // Sorted descending (most recent first)
  const mondays = [...mondaySet].sort().reverse();

  const thisMondayKey = toMondayOfWeek(new Date().toISOString());
  const thisMon = new Date(thisMondayKey + "T00:00:00");
  const latestMon = new Date(mondays[0] + "T00:00:00");
  const gapFromNow = Math.round(
    (thisMon.getTime() - latestMon.getTime()) / (1000 * 60 * 60 * 24)
  );

  let current = 0;
  let currentStart: string | null = null;
  if (gapFromNow <= 7) {
    let expected = latestMon;
    for (const m of mondays) {
      const curr = new Date(m + "T00:00:00");
      const diff = Math.round(
        (expected.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diff > 7) break;
      current++;
      currentStart = m;
      expected = new Date(curr);
      expected.setDate(expected.getDate() - 7);
    }
  }

  // Best streak: find the longest run of consecutive weeks anywhere
  // mondays are sorted descending, so a run's "start" is the last index and "end" is the first index
  let best = 0;
  let bestStartIdx = 0;
  let bestEndIdx = 0;
  let run = 1;
  let runStartIdx = 0;
  for (let i = 1; i < mondays.length; i++) {
    const prev = new Date(mondays[i - 1] + "T00:00:00");
    const curr = new Date(mondays[i] + "T00:00:00");
    const diff = Math.round(
      (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diff <= 7) {
      run++;
    } else {
      if (run > best) {
        best = run;
        bestEndIdx = runStartIdx;
        bestStartIdx = i - 1;
      }
      run = 1;
      runStartIdx = i;
    }
  }
  if (run > best) {
    best = run;
    bestEndIdx = runStartIdx;
    bestStartIdx = mondays.length - 1;
  }

  const bestStart = mondays[bestStartIdx] ?? null;
  const bestEnd = mondays[bestEndIdx] ?? null;
  const bestIsCurrent = bestEnd === mondays[0] && gapFromNow <= 7;

  return { current, currentStart, best, bestStart, bestEnd, bestIsCurrent };
}

export default function CheckInsPanel({ token }: { token: string }) {
  const [checkins, setCheckins] = useState<CheckInWithVillager[]>([]);
  const [villagers, setVillagers] = useState<Villager[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [filterVillagerId, setFilterVillagerId] = useState("");
  const [last24hOnly, setLast24hOnly] = useState(true);

  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CheckInForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [allCheckins, setAllCheckins] = useState<CheckInWithVillager[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<CheckInWithVillager | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  // Quick "mark paid (cash)" flow — a single amount field instead of the full
  // edit modal, for the common case of a villager paying cash at the desk.
  const [quickPayTarget, setQuickPayTarget] =
    useState<CheckInWithVillager | null>(null);
  const [quickPayAmount, setQuickPayAmount] = useState("5");
  const [quickPaying, setQuickPaying] = useState(false);
  const [quickPayError, setQuickPayError] = useState("");

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

  const loadCheckins = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filterVillagerId) params.set("villager_id", filterVillagerId);
      const res = await apiFetch(`/api/admin/checkins?${params}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to load check-ins");
      }
      const { checkins } = await res.json();
      setCheckins(checkins);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load check-ins");
    } finally {
      setLoading(false);
    }
  }, [filterVillagerId, apiFetch]);

  const loadAllCheckins = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/checkins");
      if (res.ok) {
        const { checkins } = await res.json();
        setAllCheckins(checkins);
      }
    } catch {
      // Non-critical for stats
    }
  }, [apiFetch]);

  const loadVillagers = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/villagers?sort_by=display_name&sort_dir=asc");
      if (res.ok) {
        const { villagers } = await res.json();
        setVillagers(villagers);
      }
    } catch {
      // Villager list is for the dropdown; non-critical
    }
  }, [apiFetch]);

  useEffect(() => {
    loadCheckins();
  }, [loadCheckins]);

  useEffect(() => {
    loadVillagers();
    loadAllCheckins();
  }, [loadVillagers, loadAllCheckins]);

  function openCreate() {
    setForm({ ...EMPTY_FORM, created_at: new Date().toISOString() });
    setEditingId(null);
    setFormError("");
    setModalMode("create");
  }

  function openEdit(c: CheckInWithVillager) {
    setForm({
      villager_id: c.villager_id,
      intent_amount: String(c.intent_amount),
      payment_method: c.payment_method,
      status: c.status,
      created_at: c.created_at,
      stripe_transaction_id: c.stripe_transaction_id || "",
    });
    setEditingId(c.id);
    setFormError("");
    setModalMode("edit");
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    const amount = parseInt(form.intent_amount, 10);
    if (isNaN(amount) || amount < 0) {
      setFormError("Amount must be a non-negative number (in cents).");
      setSaving(false);
      return;
    }

    const payload: Record<string, unknown> = {
      intent_amount: amount,
      payment_method: form.payment_method,
      status: form.status,
      created_at: form.created_at || new Date().toISOString(),
      stripe_transaction_id: form.stripe_transaction_id || null,
    };

    if (modalMode === "create") {
      payload.villager_id = form.villager_id;
    }

    try {
      const url =
        modalMode === "edit"
          ? `/api/admin/checkins/${editingId}`
          : "/api/admin/checkins";
      const method = modalMode === "edit" ? "PUT" : "POST";
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Save failed");
      }
      setModalMode(null);
      loadCheckins();
      loadAllCheckins();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/admin/checkins/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Delete failed");
      }
      setDeleteTarget(null);
      loadCheckins();
      loadAllCheckins();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  function openQuickPay(c: CheckInWithVillager) {
    setQuickPayTarget(c);
    setQuickPayAmount(
      c.intent_amount > 0 ? (c.intent_amount / 100).toString() : "5"
    );
    setQuickPayError("");
  }

  async function handleQuickPay() {
    if (!quickPayTarget) return;
    const dollars = parseFloat(quickPayAmount);
    if (isNaN(dollars) || dollars < 0) {
      setQuickPayError("Enter a valid amount.");
      return;
    }
    setQuickPaying(true);
    setQuickPayError("");
    try {
      const res = await apiFetch(`/api/admin/checkins/${quickPayTarget.id}`, {
        method: "PUT",
        body: JSON.stringify({
          status: "paid",
          payment_method: "cash",
          intent_amount: Math.round(dollars * 100),
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to mark paid");
      }
      setQuickPayTarget(null);
      loadCheckins();
      loadAllCheckins();
    } catch (e: unknown) {
      setQuickPayError(e instanceof Error ? e.message : "Failed to mark paid");
    } finally {
      setQuickPaying(false);
    }
  }

  const displayedCheckins = useMemo(() => {
    if (!last24hOnly) return checkins;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return checkins.filter((c) => new Date(c.created_at).getTime() >= cutoff);
  }, [checkins, last24hOnly]);

  const last24hStats = useMemo(() => {
    if (!last24hOnly) return null;

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const isRecent = (iso: string) => new Date(iso).getTime() >= cutoff;

    const paid = displayedCheckins.filter(
      (c) => c.status === "paid" && c.payment_method !== "subscription"
    );
    const total = paid.reduce((s, c) => s + c.intent_amount, 0);
    const avgPayment = paid.length > 0 ? total / paid.length : 0;
    const uniqueVillagers = new Set(
      displayedCheckins.map((c) => c.villager_id)
    ).size;

    // A villager is "new" when their earliest check-in across all
    // history falls within the past 24 hours.
    const firstSeen = new Map<string, number>();
    for (const c of allCheckins) {
      const t = new Date(c.created_at).getTime();
      const prev = firstSeen.get(c.villager_id);
      if (prev === undefined || t < prev) firstSeen.set(c.villager_id, t);
    }
    let newVillagers = 0;
    for (const vid of new Set(displayedCheckins.map((c) => c.villager_id))) {
      const first = firstSeen.get(vid);
      if (first !== undefined && isRecent(new Date(first).toISOString())) {
        newVillagers++;
      }
    }

    return {
      count: displayedCheckins.length,
      total,
      avgPayment,
      uniqueVillagers,
      newVillagers,
    };
  }, [last24hOnly, displayedCheckins, allCheckins]);

  const villagerStats = useMemo(() => {
    if (!filterVillagerId || checkins.length === 0) return null;

    // Subscription check-ins are "paid" but carry no at-the-desk amount, so
    // they're excluded from monetary averages to avoid dragging them to $0.
    const paidCheckins = checkins.filter(
      (c) => c.status === "paid" && c.payment_method !== "subscription"
    );
    const totalCheckins = checkins.length;
    const totalContributed = paidCheckins.reduce((sum, c) => sum + c.intent_amount, 0);
    const avgContribution = paidCheckins.length > 0 ? totalContributed / paidCheckins.length : 0;

    const monthKeys = new Set(
      paidCheckins.map((c) => {
        const d = new Date(c.created_at);
        return `${d.getFullYear()}-${d.getMonth()}`;
      })
    );
    const avgMonthly = monthKeys.size > 0 ? totalContributed / monthKeys.size : 0;

    const streaks = computeStreaks(checkins);

    const byVillager = new Map<string, number[]>();
    for (const c of allCheckins) {
      if (c.status !== "paid" || c.payment_method === "subscription") continue;
      const arr = byVillager.get(c.villager_id) ?? [];
      arr.push(c.intent_amount);
      byVillager.set(c.villager_id, arr);
    }
    let globalAvgOfAvgs = 0;
    if (byVillager.size > 0) {
      let sumOfAvgs = 0;
      for (const amounts of byVillager.values()) {
        sumOfAvgs += amounts.reduce((a, b) => a + b, 0) / amounts.length;
      }
      globalAvgOfAvgs = sumOfAvgs / byVillager.size;
    }
    const diffFromGlobal = avgContribution - globalAvgOfAvgs;

    return {
      totalCheckins,
      currentStreak: streaks.current,
      currentStreakStart: streaks.currentStart,
      bestStreak: streaks.best,
      bestStart: streaks.bestStart,
      bestEnd: streaks.bestEnd,
      bestIsCurrent: streaks.bestIsCurrent,
      totalContributed,
      avgContribution,
      avgMonthly,
      diffFromGlobal,
    };
  }, [filterVillagerId, checkins, allCheckins]);

  const globalStats = useMemo(() => {
    if (filterVillagerId || allCheckins.length === 0) return null;

    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekCheckins = allCheckins.filter((c) => {
      const d = new Date(c.created_at);
      return d >= weekStart && d < weekEnd;
    });

    const weekPaid = weekCheckins.filter(
      (c) => c.status === "paid" && c.payment_method !== "subscription"
    );
    const weekTotal = weekPaid.reduce((s, c) => s + c.intent_amount, 0);
    const weekAvgPayment =
      weekPaid.length > 0
        ? weekTotal / weekPaid.length
        : 0;

    const weekVillagerIds = new Set(weekCheckins.map((c) => c.villager_id));

    const excludedIds = new Set(
      villagers.filter((v) => v.exclude_from_new).map((v) => v.id)
    );

    const checkinsByVillager = new Map<string, CheckInWithVillager[]>();
    for (const c of allCheckins) {
      const arr = checkinsByVillager.get(c.villager_id) ?? [];
      arr.push(c);
      checkinsByVillager.set(c.villager_id, arr);
    }

    let streakSum = 0;
    let streakCount = 0;
    let newVillagers = 0;
    for (const vid of weekVillagerIds) {
      const vCheckins = checkinsByVillager.get(vid) ?? [];
      if (vCheckins.length === 1 && !excludedIds.has(vid)) newVillagers++;
      const { current } = computeStreaks(vCheckins);
      streakSum += current;
      streakCount++;
    }
    const avgStreak = streakCount > 0 ? streakSum / streakCount : 0;

    return {
      weekCheckins: weekCheckins.length,
      weekTotal,
      weekAvgPayment,
      avgStreak,
      newVillagers,
    };
  }, [filterVillagerId, allCheckins, villagers]);

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Check-ins</h2>
          <p className="text-sm text-[var(--color-muted)]">
            {displayedCheckins.length} {last24hOnly ? "in the past 24 hours" : "total"}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)]"
        >
          + Add Check-in
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={filterVillagerId}
          onChange={(e) => setFilterVillagerId(e.target.value)}
          className="max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
        >
          <option value="">All villagers</option>
          {villagers.map((v) => (
            <option key={v.id} value={v.id}>
              {v.display_name}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium select-none">
          <input
            type="checkbox"
            checked={last24hOnly}
            onChange={(e) => setLast24hOnly(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          />
          Past 24 hours
        </label>
      </div>

      {/* Past 24h Stats */}
      {last24hStats && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Check-ins (24h)" value={String(last24hStats.count)} />
          <StatCard label="Total (24h)" value={formatCents(last24hStats.total)} />
          <StatCard
            label="Avg Payment (24h)"
            value={formatCents(Math.round(last24hStats.avgPayment))}
          />
          {!filterVillagerId && (
            <>
              <StatCard
                label="Villagers (24h)"
                value={String(last24hStats.uniqueVillagers)}
              />
              <StatCard
                label="New Villagers (24h)"
                value={String(last24hStats.newVillagers)}
              />
            </>
          )}
        </div>
      )}

      {/* Villager Stats */}
      {!last24hOnly && villagerStats && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <StatCard label="Total Check-ins" value={String(villagerStats.totalCheckins)} />
          <StatCard
            label="Current Streak"
            value={`${villagerStats.currentStreak} wk${villagerStats.currentStreak !== 1 ? "s" : ""}`}
            subtitle={villagerStats.currentStreakStart ? `Starting ${formatMD(villagerStats.currentStreakStart)}` : undefined}
          />
          <StatCard
            label="Best Streak"
            value={`${villagerStats.bestStreak} wk${villagerStats.bestStreak !== 1 ? "s" : ""}`}
            subtitle={villagerStats.bestStart ? `${formatMD(villagerStats.bestStart)} – ${villagerStats.bestIsCurrent ? "present" : formatMD(villagerStats.bestEnd!)}` : undefined}
          />
          <StatCard label="Total Contributed" value={formatCents(villagerStats.totalContributed)} />
          <StatCard label="Avg Contribution" value={formatCents(Math.round(villagerStats.avgContribution))} />
          <StatCard label="Avg Monthly" value={formatCents(Math.round(villagerStats.avgMonthly))} />
          <StatCard
            label="vs. Global Avg"
            value={`${Math.round(villagerStats.diffFromGlobal) === 0 ? "±" : villagerStats.diffFromGlobal > 0 ? "+" : ""}${formatCents(Math.round(villagerStats.diffFromGlobal))}`}
            highlight={Math.round(villagerStats.diffFromGlobal) === 0 ? "yellow" : villagerStats.diffFromGlobal > 0 ? "green" : "red"}
          />
        </div>
      )}

      {/* Global Stats (All Villagers) */}
      {!last24hOnly && globalStats && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="This Week's Check-ins" value={String(globalStats.weekCheckins)} />
          <StatCard label="This Week's Total" value={formatCents(globalStats.weekTotal)} />
          <StatCard label="This Week's Avg Payment" value={formatCents(Math.round(globalStats.weekAvgPayment))} />
          <StatCard label="Avg Streak (This Week)" value={`${globalStats.avgStreak.toFixed(1)} wks`} />
          <StatCard label="New Villagers This Week" value={String(globalStats.newVillagers)} />
        </div>
      )}

      {/* Error */}
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

      {/* Table */}
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
              <th className="hidden px-4 py-3 font-semibold text-[var(--color-muted)] md:table-cell">
                Method
              </th>
              <th className="px-4 py-3 font-semibold text-[var(--color-muted)]">
                Status
              </th>
              <th className="hidden px-4 py-3 font-semibold text-[var(--color-muted)] md:table-cell">
                Date
              </th>
              <th className="hidden px-4 py-3 font-semibold text-[var(--color-muted)] lg:table-cell">
                Stripe ID
              </th>
              <th className="px-4 py-3 text-right font-semibold text-[var(--color-muted)]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-[var(--color-muted)]"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && displayedCheckins.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-[var(--color-muted)]"
                >
                  {last24hOnly
                    ? "No check-ins in the past 24 hours."
                    : "No check-ins found."}
                </td>
              </tr>
            )}
            {!loading &&
              displayedCheckins.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[var(--color-border)] transition hover:bg-[var(--color-surface)]"
                >
                  <td className="px-4 py-3 font-medium">
                    {c.villagers?.display_name || "Unknown"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatCents(c.intent_amount)}
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--color-muted)] md:table-cell">
                    {METHOD_LABELS[c.payment_method] || c.payment_method}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--color-muted)] md:table-cell">
                    {formatDate(c.created_at)}
                  </td>
                  <td className="hidden px-4 py-3 font-mono text-xs text-[var(--color-muted)] lg:table-cell">
                    {c.stripe_transaction_id ? (
                      <a
                        href={`https://dashboard.stripe.com/acct_1Tb0L0Fgl7j6G6BK/payments/${c.stripe_transaction_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--color-accent)] underline underline-offset-4 transition hover:text-[var(--color-accent-light)]"
                      >
                        {c.stripe_transaction_id}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {c.status !== "paid" && (
                      <button
                        onClick={() => openQuickPay(c)}
                        className="mr-2 rounded px-2 py-1 text-xs font-medium text-green-600 transition hover:bg-green-500/10 dark:text-green-400"
                      >
                        Mark Paid
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(c)}
                      className="mr-2 rounded px-2 py-1 text-xs font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/10"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(c)}
                      className="rounded px-2 py-1 text-xs font-medium text-red-500 transition hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Create / Edit Modal */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setModalMode(null)}
        >
          <form
            onSubmit={handleSave}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-xl"
          >
            <h2 className="mb-5 text-xl font-bold">
              {modalMode === "create" ? "Add Check-in" : "Edit Check-in"}
            </h2>

            <div className="grid gap-4">
              {modalMode === "create" && (
                <Field label="Villager" required>
                  <select
                    required
                    value={form.villager_id}
                    onChange={(e) =>
                      setForm({ ...form, villager_id: e.target.value })
                    }
                    className="input"
                  >
                    <option value="">Select a villager…</option>
                    {villagers.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.display_name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount (cents)" required>
                  <input
                    type="number"
                    required
                    min="0"
                    value={form.intent_amount}
                    onChange={(e) =>
                      setForm({ ...form, intent_amount: e.target.value })
                    }
                    placeholder="e.g. 1000 = $10.00"
                    className="input"
                  />
                </Field>

                <Field label="Payment Method" required>
                  <select
                    required
                    value={form.payment_method}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        payment_method: e.target.value as PaymentMethod,
                      })
                    }
                    className="input"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Status" required>
                  <select
                    required
                    value={form.status}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        status: e.target.value as CheckInStatus,
                      })
                    }
                    className="input"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Date">
                  <input
                    type="datetime-local"
                    value={toDatetimeLocal(form.created_at)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        created_at: fromDatetimeLocal(e.target.value),
                      })
                    }
                    className="input"
                  />
                </Field>
              </div>

              <Field label="Stripe Transaction ID">
                <input
                  type="text"
                  value={form.stripe_transaction_id}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      stripe_transaction_id: e.target.value,
                    })
                  }
                  placeholder="Optional"
                  className="input"
                />
              </Field>
            </div>

            {formError && (
              <p className="mt-4 text-sm text-red-500">{formError}</p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:bg-[var(--color-surface)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-[var(--color-accent)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
              >
                {saving
                  ? "Saving…"
                  : modalMode === "create"
                    ? "Create"
                    : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Quick "Mark Paid (Cash)" */}
      {quickPayTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setQuickPayTarget(null)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              handleQuickPay();
            }}
            className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-xl"
          >
            <h2 className="mb-1 text-lg font-bold">Mark Paid — Cash</h2>
            <p className="mb-4 text-sm text-[var(--color-muted)]">
              Recording a cash payment for{" "}
              <strong className="text-[var(--color-foreground)]">
                {quickPayTarget.villagers?.display_name || "Unknown"}
              </strong>
              .
            </p>
            <Field label="Amount ($)" required>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                autoFocus
                value={quickPayAmount}
                onChange={(e) => setQuickPayAmount(e.target.value)}
                className="input"
              />
            </Field>
            {quickPayError && (
              <p className="mt-3 text-sm text-red-500">{quickPayError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setQuickPayTarget(null)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:bg-[var(--color-surface)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={quickPaying}
                className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                {quickPaying ? "Saving…" : "Mark Paid"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-xl"
          >
            <h2 className="mb-2 text-lg font-bold">Delete Check-in</h2>
            <p className="mb-1 text-sm text-[var(--color-muted)]">
              Are you sure you want to delete this check-in for{" "}
              <strong className="text-[var(--color-foreground)]">
                {deleteTarget.villagers?.display_name || "Unknown"}
              </strong>
              ?
            </p>
            <p className="mb-6 text-sm text-red-500">
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:bg-[var(--color-surface)]"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-[var(--color-muted)]">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  highlight,
}: {
  label: string;
  value: string;
  subtitle?: string;
  highlight?: "green" | "red" | "yellow";
}) {
  const valueColor =
    highlight === "green"
      ? "text-green-600 dark:text-green-400"
      : highlight === "red"
        ? "text-red-600 dark:text-red-400"
        : highlight === "yellow"
          ? "text-yellow-600 dark:text-yellow-400"
          : "text-[var(--color-foreground)]";
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <p className="text-xs font-medium text-[var(--color-muted)]">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${valueColor}`}>
        {value}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p>
      )}
    </div>
  );
}
