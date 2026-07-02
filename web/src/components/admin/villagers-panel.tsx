"use client";

import { useState, useEffect, useCallback, useMemo, useTransition, FormEvent } from "react";
import type { Villager, VillagerSubscriptionSummary } from "@/lib/types";
import { sortRoles, sortInstruments } from "@/lib/tag-order";

// Mirror of subscription-sync's ACTIVE_STATUSES, kept local so this client
// component doesn't pull in server-only modules.
const ACTIVE_SUB_STATUSES = new Set(["active", "trialing", "past_due"]);

const SUB_STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  trialing: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  past_due:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
};

const SUB_STATUS_FALLBACK_STYLE =
  "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";

function formatSubscriptionAmount(sub: VillagerSubscriptionSummary): string {
  const dollars =
    sub.amount % 100 === 0
      ? `$${sub.amount / 100}`
      : `$${(sub.amount / 100).toFixed(2)}`;
  return `${dollars}/${sub.interval === "week" ? "wk" : "mo"}`;
}

// Sort rank: active pledges rank highest, then any other recorded subscription,
// then villagers with none. Amount breaks ties within a tier.
function subscriptionSortValue(v: Villager): number {
  const sub = v.subscription;
  if (!sub) return 0;
  const tier = ACTIVE_SUB_STATUSES.has(sub.status) ? 2_000_000 : 1_000_000;
  return tier + sub.amount;
}

type SortField = keyof Villager;
type SortDir = "asc" | "desc";
type ModalMode = "create" | "edit" | null;

type VillagerForm = {
  device_ids_text: string;
  display_name: string;
  ig_handle: string;
  roles_text: string;
  instruments_text: string;
  email: string;
  marketing_opt_in: boolean;
  test_account: boolean;
  exclude_from_new: boolean;
  first_visited_at: string;
  last_visited_at: string;
};

const EMPTY_FORM: VillagerForm = {
  device_ids_text: "",
  display_name: "",
  ig_handle: "",
  roles_text: "",
  instruments_text: "",
  email: "",
  marketing_opt_in: false,
  test_account: false,
  exclude_from_new: false,
  first_visited_at: "",
  last_visited_at: "",
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

export default function VillagersPanel({ token }: { token: string }) {
  const [villagers, setVillagers] = useState<Villager[]>([]);
  // The fetch runs inside a transition so we never call setState synchronously
  // in the load effect. `loading` stays true until the first load resolves to
  // preserve the initial loading row.
  const [isPending, startTransition] = useTransition();
  const [hasLoaded, setHasLoaded] = useState(false);
  const loading = isPending || !hasLoaded;
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("first_visited_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Villager | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const loadVillagers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await apiFetch(`/api/admin/villagers?${params}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to load villagers");
      }
      const { villagers } = await res.json();
      setError("");
      setVillagers(villagers);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load villagers");
    } finally {
      setHasLoaded(true);
    }
  }, [debouncedSearch, apiFetch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    startTransition(async () => {
      await loadVillagers();
    });
  }, [loadVillagers]);

  const sortedVillagers = useMemo(() => {
    const dateFields = new Set(["first_visited_at", "last_visited_at"]);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...villagers].sort((a, b) => {
      if (sortBy === "subscription") {
        return (subscriptionSortValue(a) - subscriptionSortValue(b)) * dir;
      }
      const av = a[sortBy];
      const bv = b[sortBy];
      if (dateFields.has(sortBy as string)) {
        const at = av ? new Date(av as string).getTime() : 0;
        const bt = bv ? new Date(bv as string).getTime() : 0;
        return (at - bt) * dir;
      }
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [villagers, sortBy, sortDir]);

  function handleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM, first_visited_at: new Date().toISOString() });
    setEditingId(null);
    setFormError("");
    setModalMode("create");
  }

  function openEdit(v: Villager) {
    setForm({
      device_ids_text: (v.device_ids ?? []).join(", "),
      display_name: v.display_name,
      ig_handle: v.ig_handle || "",
      roles_text: (v.roles ?? []).join(", "),
      instruments_text: (v.instruments ?? []).join(", "),
      email: v.email || "",
      marketing_opt_in: v.marketing_opt_in,
      test_account: v.test_account,
      exclude_from_new: v.exclude_from_new,
      first_visited_at: v.first_visited_at,
      last_visited_at: v.last_visited_at || "",
    });
    setEditingId(v.id);
    setFormError("");
    setModalMode("edit");
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    const parseList = (s: string) =>
      s.split(",").map((x) => x.trim()).filter(Boolean);

    const payload = {
      device_ids: parseList(form.device_ids_text),
      display_name: form.display_name,
      ig_handle: form.ig_handle || null,
      roles: parseList(form.roles_text),
      instruments: parseList(form.instruments_text),
      email: form.email || null,
      marketing_opt_in: form.marketing_opt_in,
      test_account: form.test_account,
      exclude_from_new: form.exclude_from_new,
      first_visited_at: form.first_visited_at || new Date().toISOString(),
      last_visited_at: form.last_visited_at || null,
    };

    try {
      const url =
        modalMode === "edit"
          ? `/api/admin/villagers/${editingId}`
          : "/api/admin/villagers";
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
      loadVillagers();
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
      const res = await apiFetch(`/api/admin/villagers/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Delete failed");
      }
      setDeleteTarget(null);
      loadVillagers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggleExcludeFromNew(v: Villager) {
    setTogglingId(v.id);
    setError("");
    try {
      const res = await apiFetch(`/api/admin/villagers/${v.id}`, {
        method: "PUT",
        body: JSON.stringify({ exclude_from_new: !v.exclude_from_new }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Update failed");
      }
      loadVillagers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setTogglingId(null);
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortBy !== field) return <span className="ml-1 opacity-30">↕</span>;
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const columns: { key: string; label: string; sortable?: boolean; hideOnMobile?: boolean }[] = [
    { key: "display_name", label: "Name", sortable: true },
    { key: "ig_handle", label: "IG Handle", sortable: true },
    { key: "roles", label: "Roles", hideOnMobile: true },
    { key: "instruments", label: "Instruments", hideOnMobile: true },
    { key: "email", label: "Email", sortable: true, hideOnMobile: true },
    { key: "subscription", label: "Subscription", sortable: true, hideOnMobile: true },
    { key: "first_visited_at", label: "First Visit", sortable: true },
    { key: "last_visited_at", label: "Last Visit", sortable: true, hideOnMobile: true },
  ];

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Villagers</h2>
          <p className="text-sm text-[var(--color-muted)]">
            {villagers.length} total
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)]"
        >
          + Add Villager
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or role…"
          className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
        />
      </div>

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
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={col.sortable ? () => handleSort(col.key as SortField) : undefined}
                  className={`px-4 py-3 font-semibold text-[var(--color-muted)] select-none transition ${col.sortable ? "cursor-pointer hover:text-[var(--color-foreground)]" : ""} ${col.hideOnMobile ? "hidden md:table-cell" : ""}`}
                >
                  {col.label}
                  {col.sortable && <SortIcon field={col.key as SortField} />}
                </th>
              ))}
              <th className="px-4 py-3 text-right font-semibold text-[var(--color-muted)]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-4 py-12 text-center text-[var(--color-muted)]"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && sortedVillagers.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-4 py-12 text-center text-[var(--color-muted)]"
                >
                  {search
                    ? "No villagers match your search."
                    : "No villagers yet."}
                </td>
              </tr>
            )}
            {!loading &&
              sortedVillagers.map((v) => (
                <tr
                  key={v.id}
                  className="border-b border-[var(--color-border)] transition hover:bg-[var(--color-surface)]"
                >
                  <td className="px-4 py-3 font-medium">
                    {v.display_name}
                    {v.test_account && (
                      <span className="ml-1.5 inline-block rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
                        test
                      </span>
                    )}
                    {v.roles?.includes("exclusive") && (
                      <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-[#2e4600] px-1.5 py-0.5 text-[8px] font-semibold uppercase text-white">
                        exclusive
                      </span>
                    )}
                    {v.exclude_from_new && (
                      <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        not new
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">
                    {v.ig_handle ? (
                      <a
                        href={`https://instagram.com/${v.ig_handle.replace(/^@/, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--color-accent)] underline underline-offset-4 transition hover:text-[var(--color-accent-light)]"
                      >
                        {v.ig_handle}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--color-muted)] md:table-cell">
                    {(() => {
                      const shown = sortRoles(
                        (v.roles ?? []).filter((r) => r !== "exclusive")
                      );
                      return shown.length ? shown.join(", ") : "—";
                    })()}
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--color-muted)] md:table-cell">
                    {v.instruments?.length
                      ? sortInstruments(v.instruments).join(", ")
                      : "—"}
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--color-muted)] md:table-cell">
                    {v.email || "—"}
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    {v.subscription ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${SUB_STATUS_STYLES[v.subscription.status] ?? SUB_STATUS_FALLBACK_STYLE}`}
                        >
                          {v.subscription.status}
                        </span>
                        <span className="whitespace-nowrap text-xs text-[var(--color-muted)]">
                          {formatSubscriptionAmount(v.subscription)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">
                    {formatDate(v.first_visited_at)}
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--color-muted)] md:table-cell">
                    {formatDate(v.last_visited_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleExcludeFromNew(v)}
                      disabled={togglingId === v.id}
                      className="mr-2 rounded px-2 py-1 text-xs font-medium text-[var(--color-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-foreground)] disabled:opacity-50"
                    >
                      {togglingId === v.id
                        ? "…"
                        : v.exclude_from_new
                          ? "Mark new"
                          : "Mark not new"}
                    </button>
                    <button
                      onClick={() => openEdit(v)}
                      className="mr-2 rounded px-2 py-1 text-xs font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/10"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(v)}
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
              {modalMode === "create" ? "Add Villager" : "Edit Villager"}
            </h2>

            <div className="grid gap-4">
              <Field label="Display Name" required>
                <input
                  type="text"
                  required
                  value={form.display_name}
                  onChange={(e) =>
                    setForm({ ...form, display_name: e.target.value })
                  }
                  className="input"
                />
              </Field>

              <Field label="IG Handle">
                <input
                  type="text"
                  value={form.ig_handle ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, ig_handle: e.target.value })
                  }
                  placeholder="@handle"
                  className="input"
                />
              </Field>

              <Field label="Device IDs">
                <input
                  type="text"
                  value={form.device_ids_text}
                  onChange={(e) =>
                    setForm({ ...form, device_ids_text: e.target.value })
                  }
                  placeholder="Comma-separated device identifiers"
                  className="input"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Roles">
                  <input
                    type="text"
                    value={form.roles_text}
                    onChange={(e) =>
                      setForm({ ...form, roles_text: e.target.value })
                    }
                    placeholder="Producer, Vocalist, Musician, Elder"
                    className="input"
                  />
                </Field>

                <Field label="Instruments">
                  <input
                    type="text"
                    value={form.instruments_text}
                    onChange={(e) =>
                      setForm({ ...form, instruments_text: e.target.value })
                    }
                    placeholder="Keys, Guitar, Bass"
                    className="input"
                  />
                </Field>
              </div>

              <Field label="Email">
                <input
                  type="email"
                  value={form.email ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, email: e.target.value })
                  }
                  className="input"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First Visited">
                  <input
                    type="datetime-local"
                    value={toDatetimeLocal(form.first_visited_at)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        first_visited_at: fromDatetimeLocal(e.target.value),
                      })
                    }
                    className="input"
                  />
                </Field>

                <Field label="Last Visited">
                  <input
                    type="datetime-local"
                    value={toDatetimeLocal(form.last_visited_at)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        last_visited_at: fromDatetimeLocal(e.target.value),
                      })
                    }
                    className="input"
                  />
                </Field>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--color-muted)]">Marketing opt-in</span>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, marketing_opt_in: !form.marketing_opt_in })}
                  className={`relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
                    form.marketing_opt_in ? "bg-green-500" : "bg-[var(--color-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      form.marketing_opt_in ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-[var(--color-muted)]">Test account</span>
                  <span className="text-xs text-[var(--color-muted)]">(allows multiple daily check-ins)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, test_account: !form.test_account })}
                  className={`relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
                    form.test_account ? "bg-green-500" : "bg-[var(--color-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      form.test_account ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-[var(--color-muted)]">Exclude from &ldquo;New Villagers&rdquo;</span>
                  <span className="text-xs text-[var(--color-muted)]">(hides from the weekly stat)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, exclude_from_new: !form.exclude_from_new })}
                  className={`relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
                    form.exclude_from_new ? "bg-green-500" : "bg-[var(--color-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      form.exclude_from_new ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
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
            <h2 className="mb-2 text-lg font-bold">Delete Villager</h2>
            <p className="mb-1 text-sm text-[var(--color-muted)]">
              Are you sure you want to delete{" "}
              <strong className="text-[var(--color-foreground)]">
                {deleteTarget.display_name}
              </strong>
              ?
            </p>
            <p className="mb-6 text-sm text-red-500">
              This will also delete all their check-in history and cannot be
              undone.
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
