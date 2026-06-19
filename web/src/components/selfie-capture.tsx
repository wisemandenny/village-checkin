"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SelfieCaptureProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

// Edge length of the stored selfie. Kept small because the image is stored as a
// base64 data URL on the villager row and returned in the "who's here" feed.
const OUTPUT_SIZE = 320;
const JPEG_QUALITY = 0.8;

// Center-crop the source to a square and downscale to OUTPUT_SIZE, then encode
// as a JPEG data URL.
function toSquareDataUrl(
  source: CanvasImageSource,
  width: number,
  height: number
): string | null {
  if (!width || !height) return null;
  const side = Math.min(width, height);
  const sx = (width - side) / 2;
  const sy = (height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export function SelfieCapture({ value, onChange }: SelfieCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  // Always release the camera when the component unmounts.
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setActive(true);
      // Wait for the <video> to mount (active just flipped) before wiring it up.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setError("Couldn't open the camera. You can upload a photo instead.");
    } finally {
      setStarting(false);
    }
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const dataUrl = toSquareDataUrl(video, video.videoWidth, video.videoHeight);
    stopCamera();
    if (dataUrl) onChange(dataUrl);
  }, [onChange, stopCamera]);

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const dataUrl = toSquareDataUrl(img, img.naturalWidth, img.naturalHeight);
        URL.revokeObjectURL(url);
        if (dataUrl) onChange(dataUrl);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        setError("That image couldn't be read. Try another one.");
      };
      img.src = url;
    },
    [onChange]
  );

  const label = "Add a selfie";

  // Captured: show the photo with retake/remove controls.
  if (value && !active) {
    return (
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium text-[var(--color-muted)]">
          {label} <span className="font-normal opacity-60">(shown on &ldquo;who&apos;s here&rdquo;)</span>
        </span>
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Your selfie"
            className="h-24 w-24 rounded-2xl border border-[var(--color-border)] object-cover"
          />
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={startCamera}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium transition hover:border-[var(--color-accent)]/50"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-lg px-3 py-2 text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Live camera preview with a capture button.
  if (active) {
    return (
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium text-[var(--color-muted)]">{label}</span>
        <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className="aspect-square w-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={capture}
            className="flex-1 rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)]"
          >
            Capture
          </button>
          <button
            type="button"
            onClick={stopCamera}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium transition hover:border-[var(--color-accent)]/50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Idle: offer to open the camera, with a file-upload fallback.
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[var(--color-muted)]">
        {label} <span className="font-normal opacity-60">(optional)</span>
      </span>
      <button
        type="button"
        onClick={startCamera}
        disabled={starting}
        className="flex h-12 items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-base font-medium text-[var(--color-muted)] transition hover:border-[var(--color-accent)]/50 disabled:opacity-50 font-[family-name:var(--font-domaine)]"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
        {starting ? "Opening camera…" : "Take a selfie"}
      </button>
      <label className="cursor-pointer text-center text-xs text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]">
        or upload a photo
        <input type="file" accept="image/*" capture="user" onChange={onFile} className="hidden" />
      </label>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
