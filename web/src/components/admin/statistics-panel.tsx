"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { CheckIn, Villager } from "@/lib/types";

type CheckInWithVillager = CheckIn & {
  villagers: { display_name: string } | null;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Chart palette — explicit colors that read well in both light and dark themes.
const COLORS = {
  checkins: "#6366f1",
  revenue: "#16a34a",
  avg: "#0ea5e9",
  unique: "#0ea5e9",
  newVillagers: "#8b5cf6",
  unpaidCount: "#f59e0b",
  unpaidOwed: "#dc2626",
};

function formatCents(cents: number): string {
  if (cents === 0) return "$0";
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Map any check-in timestamp to the Monday of its week.
 * Special case: Tue 12am–4am rolls back to the previous Monday (late session).
 * Mirrors the logic used by the Check-ins tab so the two views agree.
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

function mondayDate(key: string): Date {
  return new Date(key + "T00:00:00");
}

function formatMD(mondayKey: string): string {
  const d = mondayDate(mondayKey);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Is this check-in a real monetary payment? Subscription visits carry no
 *  at-the-desk amount, so they're excluded from revenue/averages. */
function isPaid(c: CheckIn): boolean {
  return c.status === "paid" && c.payment_method !== "subscription";
}

type WeekRange = 8 | 12 | 26 | "all";

interface WeekBucket {
  week: string; // M/D label for the x-axis
  key: string; // Monday key
  checkins: number;
  revenue: number; // dollars (paid, non-subscription)
  revenueCents: number;
  avg: number; // dollars per paid check-in
  unique: number; // distinct villagers active that week
  newVillagers: number; // villagers whose first-ever visit lands this week
  unpaidCount: number; // pending check-ins
  unpaidOwed: number; // dollars still owed (pending intent_amount)
  unpaidOwedCents: number;
}

export default function StatisticsPanel({ token }: { token: string }) {
  const [allCheckins, setAllCheckins] = useState<CheckInWithVillager[]>([]);
  const [villagers, setVillagers] = useState<Villager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filterVillagerId, setFilterVillagerId] = useState("");
  const [newVillagersOnly, setNewVillagersOnly] = useState(false);
  const [range, setRange] = useState<WeekRange>(12);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [checkinsRes, villagersRes] = await Promise.all([
        apiFetch("/api/admin/checkins"),
        apiFetch("/api/admin/villagers?sort_by=display_name&sort_dir=asc"),
      ]);
      if (!checkinsRes.ok) {
        const body = await checkinsRes.json();
        throw new Error(body.error || "Failed to load check-ins");
      }
      const { checkins } = await checkinsRes.json();
      setAllCheckins(checkins);
      if (villagersRes.ok) {
        const { villagers } = await villagersRes.json();
        setVillagers(villagers);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load statistics");
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  // Earliest-ever check-in per villager (across all history, ignoring filters)
  // so a villager's "new" status is stable regardless of what's displayed.
  const firstSeen = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of allCheckins) {
      const t = new Date(c.created_at).getTime();
      const prev = m.get(c.villager_id);
      if (prev === undefined || t < prev) m.set(c.villager_id, t);
    }
    return m;
  }, [allCheckins]);

  const excludedIds = useMemo(
    () => new Set(villagers.filter((v) => v.exclude_from_new).map((v) => v.id)),
    [villagers]
  );

  const weeks = useMemo<WeekBucket[]>(() => {
    if (allCheckins.length === 0) return [];

    const thisMondayKey = toMondayOfWeek(new Date().toISOString());
    const endMonday = mondayDate(thisMondayKey);

    // Determine the first week to display.
    let startMonday: Date;
    if (range === "all") {
      let earliest = Infinity;
      for (const c of allCheckins) {
        const k = mondayDate(toMondayOfWeek(c.created_at)).getTime();
        if (k < earliest) earliest = k;
      }
      startMonday = earliest === Infinity ? endMonday : new Date(earliest);
    } else {
      startMonday = new Date(endMonday.getTime() - (range - 1) * WEEK_MS);
    }

    // Build a continuous list of week keys so empty weeks still render as gaps.
    const weekKeys: string[] = [];
    for (
      let d = new Date(startMonday);
      d.getTime() <= endMonday.getTime();
      d = new Date(d.getTime() + WEEK_MS)
    ) {
      weekKeys.push(toMondayOfWeek(d.toISOString()));
    }
    const startTime = startMonday.getTime();

    // "New villagers only" restricts to villagers whose first-ever visit falls
    // within the displayed range and who aren't excluded from new counts.
    const newInRange = (vid: string) => {
      const first = firstSeen.get(vid);
      return (
        first !== undefined &&
        mondayDate(toMondayOfWeek(new Date(first).toISOString())).getTime() >=
          startTime &&
        !excludedIds.has(vid)
      );
    };

    let source = allCheckins;
    if (filterVillagerId) {
      source = source.filter((c) => c.villager_id === filterVillagerId);
    }
    if (newVillagersOnly) {
      source = source.filter((c) => newInRange(c.villager_id));
    }

    const byWeek = new Map<string, CheckInWithVillager[]>();
    for (const c of source) {
      const k = toMondayOfWeek(c.created_at);
      const arr = byWeek.get(k) ?? [];
      arr.push(c);
      byWeek.set(k, arr);
    }

    return weekKeys.map((key) => {
      const rows = byWeek.get(key) ?? [];
      const paid = rows.filter(isPaid);
      const revenueCents = paid.reduce((s, c) => s + c.intent_amount, 0);
      const avgCents = paid.length > 0 ? revenueCents / paid.length : 0;
      const unique = new Set(rows.map((c) => c.villager_id)).size;

      // Villagers whose first-ever visit lands in this week (and not excluded).
      let newVillagers = 0;
      for (const vid of new Set(rows.map((c) => c.villager_id))) {
        const first = firstSeen.get(vid);
        if (
          first !== undefined &&
          toMondayOfWeek(new Date(first).toISOString()) === key &&
          !excludedIds.has(vid)
        ) {
          newVillagers++;
        }
      }

      const pending = rows.filter((c) => c.status === "pending");
      const unpaidOwedCents = pending.reduce((s, c) => s + c.intent_amount, 0);

      return {
        week: formatMD(key),
        key,
        checkins: rows.length,
        revenue: revenueCents / 100,
        revenueCents,
        avg: avgCents / 100,
        unique,
        newVillagers,
        unpaidCount: pending.length,
        unpaidOwed: unpaidOwedCents / 100,
        unpaidOwedCents,
      };
    });
  }, [allCheckins, range, filterVillagerId, newVillagersOnly, firstSeen, excludedIds]);

  const totals = useMemo(() => {
    return weeks.reduce(
      (acc, w) => {
        acc.checkins += w.checkins;
        acc.revenueCents += w.revenueCents;
        acc.paidWeeks += w.revenueCents > 0 ? 1 : 0;
        acc.newVillagers += w.newVillagers;
        acc.unpaidCount += w.unpaidCount;
        acc.unpaidOwedCents += w.unpaidOwedCents;
        return acc;
      },
      {
        checkins: 0,
        revenueCents: 0,
        paidWeeks: 0,
        newVillagers: 0,
        unpaidCount: 0,
        unpaidOwedCents: 0,
      }
    );
  }, [weeks]);

  const avgPaymentCents = useMemo(() => {
    let paid = 0;
    let total = 0;
    const start = weeks[0]?.key;
    if (!start) return 0;
    // Recompute the average across the displayed weeks at the check-in level
    // (not an average of weekly averages) for an accurate per-payment figure.
    const startTime = mondayDate(start).getTime();
    let source = allCheckins.filter(
      (c) => mondayDate(toMondayOfWeek(c.created_at)).getTime() >= startTime
    );
    if (filterVillagerId)
      source = source.filter((c) => c.villager_id === filterVillagerId);
    for (const c of source) {
      if (isPaid(c)) {
        total += c.intent_amount;
        paid++;
      }
    }
    return paid > 0 ? total / paid : 0;
  }, [weeks, allCheckins, filterVillagerId]);

  const tooltipStyle = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--color-foreground)",
  } as const;

  const hasData = weeks.length > 0;
  const showVillagerCharts = !filterVillagerId;

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold">Statistics</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Week-over-week trends across the studio&apos;s check-in activity.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          value={filterVillagerId}
          onChange={(e) => setFilterVillagerId(e.target.value)}
          className="max-w-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
        >
          <option value="">All villagers</option>
          {villagers.map((v) => (
            <option key={v.id} value={v.id}>
              {v.display_name}
            </option>
          ))}
        </select>

        <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
          {([8, 12, 26, "all"] as WeekRange[]).map((r) => (
            <button
              key={String(r)}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                range === r
                  ? "bg-[var(--color-background)] text-[var(--color-foreground)] shadow-sm"
                  : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {r === "all" ? "All" : `${r}w`}
            </button>
          ))}
        </div>

        <label
          className={`flex items-center gap-2 text-sm font-medium select-none ${
            filterVillagerId ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            disabled={!!filterVillagerId}
            checked={newVillagersOnly}
            onChange={(e) => setNewVillagersOnly(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          />
          New villagers only
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
          <button onClick={() => load()} className="ml-3 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-[var(--color-border)] px-4 py-12 text-center text-[var(--color-muted)]">
          Loading…
        </div>
      )}

      {!loading && !hasData && (
        <div className="rounded-xl border border-[var(--color-border)] px-4 py-12 text-center text-[var(--color-muted)]">
          No check-in data available yet.
        </div>
      )}

      {!loading && hasData && (
        <>
          {/* Summary cards for the displayed range */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Check-ins" value={String(totals.checkins)} />
            <StatCard label="Revenue" value={formatCents(totals.revenueCents)} />
            <StatCard
              label="Avg Payment"
              value={formatCents(Math.round(avgPaymentCents))}
            />
            {showVillagerCharts && (
              <StatCard
                label="New Villagers"
                value={String(totals.newVillagers)}
              />
            )}
            <StatCard
              label="Unpaid Check-ins"
              value={String(totals.unpaidCount)}
              highlight={totals.unpaidCount > 0 ? "yellow" : undefined}
            />
            <StatCard
              label="Unpaid Owed"
              value={formatCents(totals.unpaidOwedCents)}
              highlight={totals.unpaidOwedCents > 0 ? "red" : undefined}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="Check-ins per week">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={weeks} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-border)", opacity: 0.3 }} />
                  <Bar dataKey="checkins" name="Check-ins" fill={COLORS.checkins} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Revenue per week">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={weeks} margin={{ top: 8, right: 12, left: -4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="var(--color-muted)" tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, "Revenue"]} />
                  <Line type="monotone" dataKey="revenue" name="Revenue" stroke={COLORS.revenue} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Average payment per week">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={weeks} margin={{ top: 8, right: 12, left: -4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="var(--color-muted)" tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, "Avg payment"]} />
                  <Line type="monotone" dataKey="avg" name="Avg payment" stroke={COLORS.avg} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            {showVillagerCharts && (
              <ChartCard title="Villagers per week">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={weeks} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-border)", opacity: 0.3 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="unique" name="Active" fill={COLORS.unique} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="newVillagers" name="New" fill={COLORS.newVillagers} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            <ChartCard title="Unpaid check-ins per week">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={weeks} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                  <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} stroke="var(--color-muted)" tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "var(--color-border)", opacity: 0.3 }}
                    formatter={(v, name) =>
                      name === "Owed"
                        ? [`$${Number(v ?? 0).toFixed(2)}`, name]
                        : [String(v ?? 0), name]
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="unpaidCount" name="Unpaid" fill={COLORS.unpaidCount} radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="unpaidOwed" name="Owed" stroke={COLORS.unpaidOwed} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}
    </>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="mb-4 text-sm font-semibold text-[var(--color-foreground)]">
        {title}
      </h3>
      {children}
    </div>
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
