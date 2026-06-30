"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getDeviceId } from "@/lib/device-id";
import { ACCEPT, useGalleryUpload } from "@/lib/use-gallery-upload";

interface GalleryItem {
  id: string;
  kind: "photo" | "video";
  url: string;
  display_name: string;
  villager_id: string;
  created_at: string;
}

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<GalleryItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { me, uploading, uploadProgress, error, setError, uploadFiles } =
    useGalleryUpload();

  const loadGallery = useCallback(async () => {
    const res = await fetch("/api/gallery");
    if (res.ok) {
      const data = await res.json();
      setConfigured(data.configured !== false);
      setItems(data.uploads ?? []);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadGallery();
      setLoading(false);
    })();
  }, [loadGallery]);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [preview]);

  // Uploading is open to any signed-in villager; no check-in is required.
  const canUpload = configured && me && !uploading;

  async function handleUpload() {
    if (selectedFiles.length === 0 || !canUpload) return;
    const { succeeded } = await uploadFiles(selectedFiles);
    if (succeeded > 0) {
      setSelectedFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      await loadGallery();
    }
  }

  async function handleDelete(id: string) {
    const deviceId = getDeviceId();
    if (!deviceId) return;
    if (!confirm("Remove this from the gallery?")) return;

    const res = await fetch(`/api/upload/${id}?device_id=${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setItems((cur) => cur.filter((i) => i.id !== id));
    }
  }

  async function handleReport(id: string) {
    const deviceId = getDeviceId();
    if (!deviceId) return;
    if (!confirm("Report this upload for review?")) return;

    const res = await fetch(`/api/upload/${id}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId }),
    });
    if (res.ok) {
      alert("Thanks — we'll review this.");
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col items-center">
        <h1 className="text-center text-2xl font-bold font-[family-name:var(--font-domaine)]">
          Village Gallery
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {loading
            ? "Loading…"
            : configured
              ? `${items.length} recent upload${items.length === 1 ? "" : "s"}`
              : "Uploads not configured"}
        </p>

        {!loading && !configured && (
          <p className="mt-8 text-center text-sm text-[var(--color-muted)]">
            The gallery is not available right now.
          </p>
        )}

        {configured && me && (
          <div className="mt-6 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              multiple
              disabled={uploading}
              onChange={(e) => {
                setError(null);
                setSelectedFiles(Array.from(e.target.files ?? []));
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full truncate rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm font-semibold transition hover:border-[var(--color-foreground)] disabled:opacity-40"
            >
              {selectedFiles.length === 0
                ? "Choose files"
                : selectedFiles.length === 1
                  ? selectedFiles[0].name
                  : `${selectedFiles.length} files selected`}
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || uploading}
              className="mt-3 w-full rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-40"
            >
              {uploading
                ? uploadProgress ?? "Uploading…"
                : selectedFiles.length > 1
                  ? `Upload ${selectedFiles.length}`
                  : "Upload"}
            </button>
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              Photos are resized and stripped of location data. Videos keep their metadata.
            </p>
          </div>
        )}

        {configured && !me && !loading && (
          <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
            Register to upload.
          </p>
        )}

        {!loading && configured && items.length === 0 && (
          <p className="mt-10 text-center text-sm text-[var(--color-muted)]">
            Nothing shared yet — be the first!
          </p>
        )}

        <div className="mt-8 grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item) => {
            const isMine = me?.id === item.villager_id;
            return (
              <div
                key={item.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)]"
              >
                <div className="relative aspect-square bg-[var(--color-surface)]">
                  {item.kind === "photo" ? (
                    <button
                      type="button"
                      onClick={() => setPreview(item)}
                      className="h-full w-full cursor-zoom-in"
                      aria-label={`Open photo by ${item.display_name}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={`Photo by ${item.display_name}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ) : (
                    <video
                      src={item.url}
                      controls
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 px-2 py-2">
                  <span className="line-clamp-1 text-xs font-semibold">
                    {item.display_name}
                    {isMine && " (you)"}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    {isMine ? (
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        className="rounded px-2 py-1 text-[10px] text-red-500 transition hover:bg-red-500/10"
                      >
                        Remove
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReport(item.id)}
                        className="rounded px-2 py-1 text-[10px] text-[var(--color-muted)] transition hover:bg-[var(--color-surface)]"
                      >
                        Report
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-10 flex flex-col items-center gap-2">
          <Link
            href="/here"
            className="text-xs text-[var(--color-muted)] underline-offset-4 transition hover:text-[var(--color-foreground)] hover:underline"
          >
            See who&apos;s here →
          </Link>
          <Link
            href="/"
            className="text-xs text-[var(--color-muted)] underline-offset-4 transition hover:text-[var(--color-foreground)] hover:underline"
          >
            ← back
          </Link>
        </div>
      </div>

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Photo by ${preview.display_name}`}
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <button
            type="button"
            onClick={() => setPreview(null)}
            aria-label="Close preview"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white transition hover:bg-white/20"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.url}
            alt={`Photo by ${preview.display_name}`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          />
        </div>
      )}
    </main>
  );
}
