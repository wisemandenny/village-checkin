"use client";

import { useState, useEffect, useCallback } from "react";
import { isInCurrentMondayWeek } from "@/lib/gallery-weeks";

interface AdminUpload {
  id: string;
  kind: "photo" | "video";
  url: string;
  display_name: string;
  villager_id: string;
  size_bytes: number;
  reported: boolean;
  promoted_at: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
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

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Shared base so every toolbar button has identical sizing and spacing;
// per-button classes only add colors.
const toolbarButtonClass =
  "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";

function downloadFilename(item: AdminUpload): string {
  let ext = "";
  try {
    const path = new URL(item.url).pathname;
    const dot = path.lastIndexOf(".");
    if (dot !== -1) ext = path.slice(dot);
  } catch {
    // fall through to kind-based default
  }
  if (!ext) ext = item.kind === "video" ? ".mp4" : ".jpg";
  const safeName =
    item.display_name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "upload";
  return `${safeName}-${item.id.slice(0, 8)}${ext}`;
}

export default function GalleryPanel({ token }: { token: string }) {
  const [uploads, setUploads] = useState<AdminUpload[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [takingDown, setTakingDown] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [bulkTakingDown, setBulkTakingDown] = useState(false);

  function toggleSelected(id: string) {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((cur) => {
      if (ordered.length > 0 && cur.size >= ordered.length) {
        return new Set();
      }
      return new Set(ordered.map((u) => u.id));
    });
  }

  function selectAllThisWeek() {
    setSelectedIds(
      new Set(ordered.filter((u) => isInCurrentMondayWeek(u.created_at)).map((u) => u.id))
    );
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/gallery");
      if (!res.ok) throw new Error("Failed to load gallery");
      const data = await res.json();
      setConfigured(data.configured !== false);
      setUploads(data.uploads ?? []);
      setSelectedIds(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function handleTakedown(id: string) {
    if (!confirm("Permanently remove this upload from storage? This cannot be undone.")) {
      return;
    }
    setTakingDown(id);
    try {
      const res = await apiFetch(`/api/admin/gallery/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Takedown failed");
      setUploads((cur) => cur.filter((u) => u.id !== id));
      setSelectedIds((cur) => {
        if (!cur.has(id)) return cur;
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Takedown failed");
    } finally {
      setTakingDown(null);
    }
  }

  async function handlePromote(id: string, next: boolean) {
    setPromoting(id);
    try {
      const res = await apiFetch(`/api/admin/gallery/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ promoted: next }),
      });
      if (!res.ok) throw new Error("Update failed");
      setUploads((cur) =>
        cur.map((u) =>
          u.id === id
            ? { ...u, promoted_at: next ? new Date().toISOString() : null }
            : u
        )
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPromoting(null);
    }
  }

  function saveBlob(blob: Blob, filename: string) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Defer the revoke: revoking synchronously can cancel/truncate the download
    // before the browser has finished reading the blob.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }

  async function handleDownloadSelected() {
    const targets = uploads.filter((u) => selectedIds.has(u.id));
    if (targets.length === 0) return;
    setDownloading(true);
    setError("");
    try {
      if (targets.length === 1) {
        // Single selection: stream the file directly through the same-origin
        // admin proxy and save it under its own name.
        const item = targets[0];
        const res = await apiFetch(`/api/admin/gallery/${item.id}/download`);
        if (!res.ok) throw new Error(String(res.status));
        saveBlob(await res.blob(), downloadFilename(item));
      } else {
        // Multiple selections: bundle the exact selected set into one zip and
        // save it in a single action. Triggering many programmatic downloads at
        // once is unreliable (browsers coalesce rapid downloads and typically
        // only keep the last one), so a single archive guarantees every checked
        // file is delivered.
        const res = await apiFetch("/api/admin/gallery/download", {
          method: "POST",
          body: JSON.stringify({ ids: targets.map((u) => u.id) }),
        });
        if (!res.ok) throw new Error(String(res.status));
        saveBlob(await res.blob(), "village-gallery.zip");
      }
    } catch {
      setError(`Could not download ${targets.length} selected item(s).`);
    } finally {
      setDownloading(false);
    }
  }

  async function handleTakedownSelected() {
    const ids = uploads.filter((u) => selectedIds.has(u.id)).map((u) => u.id);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Permanently remove ${ids.length} upload${ids.length === 1 ? "" : "s"} from storage? This cannot be undone.`
      )
    ) {
      return;
    }
    setBulkTakingDown(true);
    setError("");
    const removed: string[] = [];
    let failures = 0;
    for (const id of ids) {
      try {
        const res = await apiFetch(`/api/admin/gallery/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Takedown failed");
        removed.push(id);
      } catch {
        failures++;
      }
    }
    if (removed.length > 0) {
      const removedSet = new Set(removed);
      setUploads((cur) => cur.filter((u) => !removedSet.has(u.id)));
      setSelectedIds((cur) => {
        const next = new Set(cur);
        for (const id of removed) next.delete(id);
        return next;
      });
    }
    if (failures > 0) {
      setError(`Could not take down ${failures} of ${ids.length} item(s).`);
    }
    setBulkTakingDown(false);
  }

  const reported = uploads.filter((u) => u.reported && !u.deleted_at);
  const rest = uploads.filter((u) => !u.reported || u.deleted_at);
  const ordered = [...reported, ...rest];
  const allSelected = ordered.length > 0 && selectedIds.size >= ordered.length;
  const thisWeekCount = ordered.filter((u) => isInCurrentMondayWeek(u.created_at)).length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Gallery moderation</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={loading || ordered.length === 0}
            className={`${toolbarButtonClass} border border-[var(--color-border)] hover:bg-[var(--color-surface)]`}
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          <button
            type="button"
            onClick={selectAllThisWeek}
            disabled={loading || thisWeekCount === 0}
            className={`${toolbarButtonClass} border border-[var(--color-border)] hover:bg-[var(--color-surface)]`}
          >
            Select all from this week
          </button>
          <button
            type="button"
            onClick={handleDownloadSelected}
            disabled={downloading || bulkTakingDown || selectedIds.size === 0}
            className={`${toolbarButtonClass} bg-green-600 text-white hover:bg-green-700`}
          >
            {downloading
              ? "Downloading…"
              : `Download${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
          </button>
          <button
            type="button"
            onClick={handleTakedownSelected}
            disabled={bulkTakingDown || downloading || selectedIds.size === 0}
            className={`${toolbarButtonClass} bg-red-600 text-white hover:bg-red-700`}
          >
            {bulkTakingDown
              ? "Removing…"
              : `Take down${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className={`${toolbarButtonClass} border border-[var(--color-border)] hover:bg-[var(--color-surface)]`}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {!configured && (
        <p className="text-sm text-[var(--color-muted)]">
          Upload storage is not configured (R2_UPLOADS_BUCKET / UPLOAD_TOKEN_SECRET).
        </p>
      )}

      {configured && ordered.length === 0 && !loading && (
        <p className="text-sm text-[var(--color-muted)]">No uploads yet.</p>
      )}

      <div className="space-y-4">
        {ordered.map((item) => (
          <div
            key={item.id}
            className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row ${
              item.reported && !item.deleted_at
                ? "border-red-400 bg-red-50/50 dark:bg-red-950/20"
                : "border-[var(--color-border)]"
            }`}
          >
            <label className="flex shrink-0 items-start pt-1 sm:items-center sm:pt-0">
              <input
                type="checkbox"
                checked={selectedIds.has(item.id)}
                onChange={() => toggleSelected(item.id)}
                className="h-5 w-5 cursor-pointer accent-[var(--color-accent)]"
                aria-label={`Select upload by ${item.display_name}`}
              />
            </label>
            <div className="h-32 w-32 shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface)]">
              {item.kind === "photo" ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <video
                  src={item.url}
                  controls
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.display_name}</span>
                <span className="text-xs text-[var(--color-muted)]">
                  {formatDate(item.created_at)} · {formatSize(item.size_bytes)}
                </span>
                {item.reported && !item.deleted_at && (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                    Reported
                  </span>
                )}
                {item.deleted_at && (
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    Hidden by villager
                  </span>
                )}
                {item.promoted_at && !item.deleted_at && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    Highlighted
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {!item.deleted_at && (
                  <button
                    type="button"
                    onClick={() => handlePromote(item.id, !item.promoted_at)}
                    disabled={promoting === item.id}
                    className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-50 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
                  >
                    {promoting === item.id
                      ? "Saving…"
                      : item.promoted_at
                        ? "Unhighlight"
                        : "Highlight"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleTakedown(item.id)}
                  disabled={takingDown === item.id}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30"
                >
                  {takingDown === item.id ? "Removing…" : "Take down"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
