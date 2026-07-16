"use client";

import { useState, useEffect, useCallback, useMemo, useTransition } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { CheckIn, Villager, Subscription } from "@/lib/types";
import { Role } from "@/lib/tag-order";
import { EXCLUSIVE_ROLE } from "@/lib/exclusive-tier";

type CheckInWithVillager = CheckIn & {
  villagers: { display_name: string } | null;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Subscription statuses that count as a live, revenue-generating pledge.
// Mirrors the Subscriptions tab's notion of "active".
const ACTIVE_SUB_STATUSES = new Set(["active", "trialing", "past_due"]);

// Normalize a pledge amount (cents) to a monthly figure for MRR. Weekly
// pledges bill ~52/12 times per month.
function toMonthlyCents(amount: number, interval: string): number {
  return interval === "week" ? (amount * 52) / 12 : amount;
}

// Least-squares linear regression, returning the fitted y for each index.
function linearTrend(ys: number[]): number[] {
  const n = ys.length;
  if (n === 0) return [];
  if (n === 1) return [ys[0]];
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += ys[i];
    sxy += i * ys[i];
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return ys.map((_, i) => intercept + slope * i);
}

// Chart palette — explicit colors that read well in both light and dark themes.
const COLORS = {
  checkins: "#6366f1",
  revenue: "#16a34a",
  avg: "#0ea5e9",
  unique: "#0ea5e9",
  newVillagers: "#8b5cf6",
  unpaidCount: "#f59e0b",
  unpaidOwed: "#dc2626",
  producers: "#6366f1",
  vocalists: "#ec4899",
  instrumentalists: "#14b8a6",
  justVibing: "#f59e0b",
  totalVillagers: "#6366f1",
  exclusive: "#eab308",
  nonExclusive: "#64748b",
  trend: "#dc2626",
  mrr: "#16a34a",
};

// Roles offered in the multiselect filter. Values are lower-cased to match the
// normalized role lists stored per villager.
const ROLE_FILTERS: { value: string; label: string }[] = [
  { value: Role.Producer.toLowerCase(), label: "Producers" },
  { value: Role.Vocalist.toLowerCase(), label: "Vocalists" },
  { value: Role.Musician.toLowerCase(), label: "Instrumentalists" },
  { value: Role.JustVibing.toLowerCase(), label: "Just Vibing" },
];

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

type RangeKey = "mtd" | "1mo" | "3mo" | "6mo" | "1y" | "all";

// Each range maps to a number of weekly buckets (or "all" / month-to-date).
// Week counts approximate the calendar period: 13w ~= 3mo, 26w ~= 6mo, 52w ~= 1y.
// MTD starts at the Monday of the week that contains the 1st of the current month.
const RANGE_OPTIONS: {
  key: RangeKey;
  label: string;
  weeks: number | "all" | "mtd";
}[] = [
  { key: "mtd", label: "MTD", weeks: "mtd" },
  { key: "1mo", label: "1M", weeks: 4 },
  { key: "3mo", label: "3M", weeks: 13 },
  { key: "6mo", label: "6M", weeks: 26 },
  { key: "1y", label: "1Y", weeks: 52 },
  { key: "all", label: "All", weeks: "all" },
];

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
  // Role breakdown of unique villagers active that week. A multi-role villager
  // counts toward each role they hold, so these can sum above `unique`.
  producers: number;
  vocalists: number;
  instrumentalists: number;
  justVibing: number;
  // Cumulative villager population as of the end of this week (registrations
  // by first_visited_at). Exclusive split uses the villager's current role.
  totalVillagers: number;
  exclusiveMembers: number;
  nonExclusiveMembers: number;
  // Linear best-fit value for unique villagers per week.
  uniqueTrend: number;
  // Monthly Recurring Revenue (subscriptions) as of this week.
  mrr: number; // dollars
  mrrCents: number;
}

export default function StatisticsPanel({ token }: { token: string }) {
  const [allCheckins, setAllCheckins] = useState<CheckInWithVillager[]>([]);
  const [villagers, setVillagers] = useState<Villager[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  // The fetch runs inside a transition so we never call setState synchronously
  // in the load effect. `loading` stays true until the first load resolves to
  // avoid a flash of the empty state before data arrives.
  const [isPending, startTransition] = useTransition();
  const [hasLoaded, setHasLoaded] = useState(false);
  const loading = isPending || !hasLoaded;
  const [error, setError] = useState("");

  const [filterVillagerId, setFilterVillagerId] = useState("");
  const [newVillagersOnly, setNewVillagersOnly] = useState(false);
  const [range, setRange] = useState<RangeKey>("mtd");
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [rolesOpen, setRolesOpen] = useState(false);

  const toggleRole = useCallback((value: string) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

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
    try {
      const [checkinsRes, villagersRes, subscriptionsRes] = await Promise.all([
        apiFetch("/api/admin/checkins"),
        apiFetch("/api/admin/villagers?sort_by=display_name&sort_dir=asc"),
        apiFetch("/api/admin/subscriptions"),
      ]);
      if (!checkinsRes.ok) {
        const body = await checkinsRes.json();
        throw new Error(body.error || "Failed to load check-ins");
      }
      const { checkins } = await checkinsRes.json();
      setError("");
      setAllCheckins(checkins);
      if (villagersRes.ok) {
        const { villagers } = await villagersRes.json();
        setVillagers(villagers);
      }
      if (subscriptionsRes.ok) {
        const { subscriptions } = await subscriptionsRes.json();
        setSubscriptions(subscriptions);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load statistics");
    } finally {
      setHasLoaded(true);
    }
  }, [apiFetch]);

  useEffect(() => {
    startTransition(async () => {
      await load();
    });
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

  // Lower-cased role list per villager, for the weekly role breakdown.
  const rolesByVillager = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of villagers) {
      m.set(v.id, (v.roles ?? []).map((r) => r.toLowerCase()));
    }
    return m;
  }, [villagers]);

  // True when a villager has at least one of the selected filter roles (or no
  // role filter is active).
  const matchesRoleFilter = useCallback(
    (vid: string) => {
      if (selectedRoles.size === 0) return true;
      const roles = rolesByVillager.get(vid) ?? [];
      return roles.some((r) => selectedRoles.has(r));
    },
    [selectedRoles, rolesByVillager]
  );

  // Villager population used by the "over time" charts: registration time and
  // current exclusive status, filtered by the active role multiselect.
  const populationVillagers = useMemo(() => {
    return villagers
      .filter((v) => matchesRoleFilter(v.id))
      .map((v) => ({
        firstVisited: new Date(v.first_visited_at).getTime(),
        isExclusive: (v.roles ?? []).some(
          (r) => r.toLowerCase() === EXCLUSIVE_ROLE
        ),
      }));
  }, [villagers, matchesRoleFilter]);

  // Active pledges contributing to MRR, normalized to a monthly amount and
  // tagged with when they started. Respects the villager and role filters.
  // Note: Stripe only gives us the current status, so a sub counts toward MRR
  // from its creation onward (cancelled pledges are excluded entirely).
  const mrrSubs = useMemo(() => {
    return subscriptions
      .filter((s) => ACTIVE_SUB_STATUSES.has(s.status))
      .filter((s) => !filterVillagerId || s.villager_id === filterVillagerId)
      .filter((s) => matchesRoleFilter(s.villager_id))
      .map((s) => ({
        createdAt: new Date(s.created_at).getTime(),
        monthlyCents: toMonthlyCents(s.amount, s.interval),
      }));
  }, [subscriptions, filterVillagerId, matchesRoleFilter]);

  const weeks = useMemo<WeekBucket[]>(() => {
    if (allCheckins.length === 0) return [];

    const thisMondayKey = toMondayOfWeek(new Date().toISOString());
    const endMonday = mondayDate(thisMondayKey);

    // Determine the first week to display.
    const weeksCount =
      RANGE_OPTIONS.find((o) => o.key === range)?.weeks ?? "all";
    let startMonday: Date;
    if (weeksCount === "all") {
      let earliest = Infinity;
      for (const c of allCheckins) {
        const k = mondayDate(toMondayOfWeek(c.created_at)).getTime();
        if (k < earliest) earliest = k;
      }
      startMonday = earliest === Infinity ? endMonday : new Date(earliest);
    } else if (weeksCount === "mtd") {
      // Calendar month-to-date: include every weekly bucket from the week that
      // contains the 1st of the current month through this week.
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      startMonday = mondayDate(toMondayOfWeek(monthStart.toISOString()));
    } else {
      startMonday = new Date(endMonday.getTime() - (weeksCount - 1) * WEEK_MS);
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
    if (selectedRoles.size > 0) {
      source = source.filter((c) => matchesRoleFilter(c.villager_id));
    }

    const byWeek = new Map<string, CheckInWithVillager[]>();
    for (const c of source) {
      const k = toMondayOfWeek(c.created_at);
      const arr = byWeek.get(k) ?? [];
      arr.push(c);
      byWeek.set(k, arr);
    }

    const buckets = weekKeys.map((key) => {
      const rows = byWeek.get(key) ?? [];
      const paid = rows.filter(isPaid);
      const revenueCents = paid.reduce((s, c) => s + c.intent_amount, 0);
      const avgCents = paid.length > 0 ? revenueCents / paid.length : 0;
      const uniqueIds = new Set(rows.map((c) => c.villager_id));
      const unique = uniqueIds.size;

      // Villagers whose first-ever visit lands in this week (and not excluded),
      // plus the role breakdown of everyone active that week.
      let newVillagers = 0;
      let producers = 0;
      let vocalists = 0;
      let instrumentalists = 0;
      let justVibing = 0;
      for (const vid of uniqueIds) {
        const first = firstSeen.get(vid);
        if (
          first !== undefined &&
          toMondayOfWeek(new Date(first).toISOString()) === key &&
          !excludedIds.has(vid)
        ) {
          newVillagers++;
        }
        const roles = rolesByVillager.get(vid) ?? [];
        if (roles.includes(Role.Producer.toLowerCase())) producers++;
        if (roles.includes(Role.Vocalist.toLowerCase())) vocalists++;
        if (roles.includes(Role.Musician.toLowerCase())) instrumentalists++;
        if (roles.includes(Role.JustVibing.toLowerCase())) justVibing++;
      }

      const pending = rows.filter((c) => c.status === "pending");
      const unpaidOwedCents = pending.reduce((s, c) => s + c.intent_amount, 0);

      // Cumulative villager population registered as of the end of this week.
      const weekEndMs = mondayDate(key).getTime() + WEEK_MS;
      let totalVillagers = 0;
      let exclusiveMembers = 0;
      for (const pv of populationVillagers) {
        if (pv.firstVisited < weekEndMs) {
          totalVillagers++;
          if (pv.isExclusive) exclusiveMembers++;
        }
      }

      // MRR as of this week: sum of monthly-normalized active pledges that had
      // started by the end of the week.
      let mrrCents = 0;
      for (const s of mrrSubs) {
        if (s.createdAt < weekEndMs) mrrCents += s.monthlyCents;
      }

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
        producers,
        vocalists,
        instrumentalists,
        justVibing,
        totalVillagers,
        exclusiveMembers,
        nonExclusiveMembers: totalVillagers - exclusiveMembers,
        uniqueTrend: 0,
        mrr: mrrCents / 100,
        mrrCents,
      };
    });

    // Overlay a best-fit line for unique villagers per week.
    const trend = linearTrend(buckets.map((b) => b.unique));
    buckets.forEach((b, i) => {
      b.uniqueTrend = Math.max(0, Math.round(trend[i] * 10) / 10);
    });

    return buckets;
  }, [allCheckins, range, filterVillagerId, newVillagersOnly, selectedRoles, matchesRoleFilter, firstSeen, excludedIds, rolesByVillager, populationVillagers, mrrSubs]);

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
    if (selectedRoles.size > 0)
      source = source.filter((c) => matchesRoleFilter(c.villager_id));
    for (const c of source) {
      if (isPaid(c)) {
        total += c.intent_amount;
        paid++;
      }
    }
    return paid > 0 ? total / paid : 0;
  }, [weeks, allCheckins, filterVillagerId, selectedRoles, matchesRoleFilter]);

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

        {/* Roles multiselect — filters every chart to villagers with any of
            the selected roles. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setRolesOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
          >
            {selectedRoles.size === 0
              ? "All roles"
              : `${selectedRoles.size} role${selectedRoles.size > 1 ? "s" : ""}`}
            <svg className="h-4 w-4 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {rolesOpen && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setRolesOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-2 shadow-lg">
                {ROLE_FILTERS.map((r) => (
                  <label
                    key={r.value}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-[var(--color-surface)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRoles.has(r.value)}
                      onChange={() => toggleRole(r.value)}
                      className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
                    />
                    {r.label}
                  </label>
                ))}
                {selectedRoles.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedRoles(new Set())}
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--color-accent)] transition hover:bg-[var(--color-surface)]"
                  >
                    Clear roles
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                range === opt.key
                  ? "bg-[var(--color-background)] text-[var(--color-foreground)] shadow-sm"
                  : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {opt.label}
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

            <ChartCard title="Monthly Recurring Revenue (MRR)">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={weeks} margin={{ top: 8, right: 12, left: -4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="var(--color-muted)" tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, "MRR"]} />
                  <Line type="monotone" dataKey="mrr" name="MRR" stroke={COLORS.mrr} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            {showVillagerCharts && (
              <ChartCard title="Villagers per week">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={weeks} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-border)", opacity: 0.3 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="unique" name="Active" fill={COLORS.unique} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="newVillagers" name="New" fill={COLORS.newVillagers} radius={[4, 4, 0, 0]} />
                    <Line type="linear" dataKey="uniqueTrend" name="Avg (best fit)" stroke={COLORS.trend} strokeWidth={2} strokeDasharray="5 4" dot={false} legendType="plainline" />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {showVillagerCharts && (
              <ChartCard title="Roles per week">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={weeks} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-border)", opacity: 0.3 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar stackId="roles" dataKey="producers" name="Producers" fill={COLORS.producers} />
                    <Bar stackId="roles" dataKey="vocalists" name="Vocalists" fill={COLORS.vocalists} />
                    <Bar stackId="roles" dataKey="instrumentalists" name="Instrumentalists" fill={COLORS.instrumentalists} />
                    <Bar stackId="roles" dataKey="justVibing" name="Just Vibing" fill={COLORS.justVibing} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {showVillagerCharts && (
              <ChartCard title="Villagers over time">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={weeks} margin={{ top: 8, right: 12, left: -4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="var(--color-muted)" />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area stackId="members" type="monotone" dataKey="nonExclusiveMembers" name="Non-exclusive" stroke={COLORS.nonExclusive} fill={COLORS.nonExclusive} fillOpacity={0.25} strokeWidth={2} />
                    <Area stackId="members" type="monotone" dataKey="exclusiveMembers" name="Exclusive" stroke={COLORS.exclusive} fill={COLORS.exclusive} fillOpacity={0.35} strokeWidth={2} />
                    <Line type="monotone" dataKey="totalVillagers" name="Total" stroke={COLORS.totalVillagers} strokeWidth={2} dot={false} legendType="plainline" />
                  </ComposedChart>
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
