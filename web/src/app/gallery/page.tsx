"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getDeviceId } from "@/lib/device-id";

interface GalleryItem {
  id: string;
  kind: "photo" | "video";
  url: string;
  display_name: string;
  villager_id: string;
  created_at: string;
}

interface Me {
  id: string;
  display_name: string;
}

const ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,video/quicktime";
const PHOTO_MAX_DIM = 2048;
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

async function reencodePhoto(file: File): Promise<{ blob: Blob; contentType: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode image"))),
      "image/jpeg",
      JPEG_QUALITY
    );
  });
  return { blob, contentType: "image/jpeg" };
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadGallery = useCallback(async () => {
    const res = await fetch("/api/gallery");
    if (res.ok) {
      const data = await res.json();
      setConfigured(data.configured !== false);
      setItems(data.uploads ?? []);
    }
  }, []);

  useEffect(() => {
    const deviceId = getDeviceId();
    (async () => {
      const tasks: Promise<unknown>[] = [loadGallery()];
      if (deviceId) {
        tasks.push(
          fetch(`/api/villager?device_id=${encodeURIComponent(deviceId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data?.villager) setMe(data.villager as Me);
            })
            .catch(() => {}),
          fetch(`/api/checkin/status?device_id=${encodeURIComponent(deviceId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              setCheckedIn(Boolean(data?.check_in));
            })
            .catch(() => {})
        );
      }
      await Promise.all(tasks);
      setLoading(false);
    })();
  }, [loadGallery]);

  const canUpload = configured && me && checkedIn && !uploading;

  async function handleSubmit() {
    if (!selectedFile || !canUpload) return;
    const deviceId = getDeviceId();
    if (!deviceId) return;

    setUploading(true);
    setError(null);
    setUploadProgress("Preparing…");

    try {
      let blob: Blob;
      let contentType: string;

      if (selectedFile.type.startsWith("image/")) {
        const encoded = await reencodePhoto(selectedFile);
        blob = encoded.blob;
        contentType = encoded.contentType;
        if (blob.size > PHOTO_MAX_BYTES) {
          throw new Error(`Photo must be ${formatSize(PHOTO_MAX_BYTES)} or smaller`);
        }
      } else {
        blob = selectedFile;
        contentType = selectedFile.type;
        if (blob.size > VIDEO_MAX_BYTES) {
          throw new Error(`Video must be ${formatSize(VIDEO_MAX_BYTES)} or smaller`);
        }
      }

      setUploadProgress("Requesting upload…");
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          content_type: contentType,
          size_bytes: blob.size,
        }),
      });
      if (!presignRes.ok) {
        const data = await presignRes.json().catch(() => ({}));
        throw new Error(data.error || "Could not start upload");
      }
      const { upload_url, object_key, upload_token } = await presignRes.json();

      setUploadProgress("Uploading…");
      const putRes = await fetch(upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
        body: blob,
      });
      if (!putRes.ok) {
        throw new Error("Upload to storage failed");
      }

      setUploadProgress("Finishing…");
      const registerRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          object_key,
          content_type: contentType,
          upload_token,
        }),
      });
      if (!registerRes.ok) {
        const data = await registerRes.json().catch(() => ({}));
        throw new Error(data.error || "Could not register upload");
      }

      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await loadGallery();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(null);
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

        {configured && me && checkedIn && (
          <div className="mt-6 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <label className="block text-sm font-medium">Share a photo or video</label>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              disabled={uploading}
              onChange={(e) => {
                setError(null);
                setSelectedFile(e.target.files?.[0] ?? null);
              }}
              className="mt-2 w-full text-sm"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!selectedFile || uploading}
              className="mt-3 w-full rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-40"
            >
              {uploading ? uploadProgress ?? "Uploading…" : "Submit"}
            </button>
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              Photos are resized and stripped of location data. Videos keep their metadata.
            </p>
          </div>
        )}

        {configured && me && !checkedIn && (
          <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
            Check in today to upload.
          </p>
        )}

        {configured && !me && !loading && (
          <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
            Register and check in to upload.
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
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={item.url}
                      alt={`Photo by ${item.display_name}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
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
    </main>
  );
}
