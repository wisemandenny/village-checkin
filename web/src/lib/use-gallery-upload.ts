"use client";

import { useCallback, useEffect, useState } from "react";
import { getDeviceId } from "@/lib/device-id";

export interface Me {
  id: string;
  display_name: string;
}

export const ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime";
export const PHOTO_MAX_DIM = 2048;
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const JPEG_QUALITY = 0.85;

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Re-encode to JPEG via canvas: downsizes and strips EXIF/location metadata.
export async function reencodePhoto(
  file: File
): Promise<{ blob: Blob; contentType: "image/jpeg" }> {
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

// One upload: presign -> PUT to R2 -> register. Photos are re-encoded first.
export async function uploadOne(file: File, deviceId: string): Promise<void> {
  let blob: Blob;
  let contentType: string;

  if (file.type.startsWith("image/")) {
    const encoded = await reencodePhoto(file);
    blob = encoded.blob;
    contentType = encoded.contentType;
    if (blob.size > PHOTO_MAX_BYTES) {
      throw new Error(`photo exceeds ${formatSize(PHOTO_MAX_BYTES)}`);
    }
  } else {
    blob = file;
    contentType = file.type;
    if (blob.size > VIDEO_MAX_BYTES) {
      throw new Error(`video exceeds ${formatSize(VIDEO_MAX_BYTES)}`);
    }
  }

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
    throw new Error(data.error || "could not start upload");
  }
  const { upload_url, object_key, upload_token } = await presignRes.json();

  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error("upload to storage failed");
  }

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
    throw new Error(data.error || "could not register upload");
  }
}

export interface UploadResult {
  succeeded: number;
  failures: string[];
}

// Shared upload state + viewer identity used by the gallery page and the
// payment-screen mosaic. Each consumer owns its own item list and reloads it
// after a successful upload; the hook owns identity, check-in status, and the
// upload orchestration (progress/error).
export function useGalleryUpload(deviceIdOverride?: string | null) {
  const [me, setMe] = useState<Me | null>(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const deviceId = deviceIdOverride ?? getDeviceId();
    let cancelled = false;
    (async () => {
      if (deviceId) {
        await Promise.all([
          fetch(`/api/villager?device_id=${encodeURIComponent(deviceId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (!cancelled && data?.villager) setMe(data.villager as Me);
            })
            .catch(() => {}),
          fetch(`/api/checkin/status?device_id=${encodeURIComponent(deviceId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (!cancelled) setCheckedIn(Boolean(data?.check_in));
            })
            .catch(() => {}),
        ]);
      }
      if (!cancelled) setIdentityLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceIdOverride]);

  const uploadFiles = useCallback(
    async (files: File[]): Promise<UploadResult> => {
      const result: UploadResult = { succeeded: 0, failures: [] };
      if (files.length === 0) return result;
      const deviceId = deviceIdOverride ?? getDeviceId();
      if (!deviceId) return result;

      setUploading(true);
      setError(null);

      // Sequential so we respect the presign rate limit and avoid re-encoding
      // many large images in parallel.
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(
          files.length === 1 ? "Uploading…" : `Uploading ${i + 1} of ${files.length}…`
        );
        try {
          await uploadOne(file, deviceId);
          result.succeeded++;
        } catch (e) {
          result.failures.push(`${file.name} (${e instanceof Error ? e.message : "failed"})`);
        }
      }

      if (result.failures.length > 0) {
        const prefix =
          result.succeeded > 0
            ? `Uploaded ${result.succeeded}, ${result.failures.length} failed: `
            : "Upload failed: ";
        setError(prefix + result.failures.join("; "));
      }

      setUploading(false);
      setUploadProgress(null);
      return result;
    },
    [deviceIdOverride]
  );

  return {
    me,
    checkedIn,
    identityLoaded,
    uploading,
    uploadProgress,
    error,
    setError,
    uploadFiles,
  };
}
