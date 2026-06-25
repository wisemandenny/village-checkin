"use client";

import { useState, useEffect, useCallback } from "react";

interface AdminUpload {
  id: string;
  kind: "photo" | "video";
  url: string;
  display_name: string;
  villager_id: string;
  size_bytes: number;
  reported: boolean;
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

export default function GalleryPanel({ token }: { token: string }) {
  const [uploads, setUploads] = useState<AdminUpload[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [takingDown, setTakingDown] = useState<string | null>(null);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    load();
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
    } catch (e) {
      alert(e instanceof Error ? e.message : "Takedown failed");
    } finally {
      setTakingDown(null);
    }
  }

  const reported = uploads.filter((u) => u.reported && !u.deleted_at);
  const rest = uploads.filter((u) => !u.reported || u.deleted_at);
  const ordered = [...reported, ...rest];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Gallery moderation</h2>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition hover:bg-[var(--color-surface)] disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
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
              </div>
              <button
                type="button"
                onClick={() => handleTakedown(item.id)}
                disabled={takingDown === item.id}
                className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30"
              >
                {takingDown === item.id ? "Removing…" : "Take down"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
