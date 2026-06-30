"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface PreviewItem {
  kind: "photo" | "video";
  url: string;
  display_name: string;
}

/**
 * Full-screen lightbox for a single gallery item. Photos render as an image,
 * videos as an autoplaying <video> with native controls. Closes on backdrop
 * click, the close button, or Escape, and locks background scroll while open.
 *
 * Rendering is driven entirely by `item`: pass the currently previewed item to
 * open, and `null` to close.
 */
export function MediaPreviewer({
  item,
  onClose,
}: {
  item: PreviewItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [item, onClose]);

  // `item` only becomes non-null via a client-side interaction, so the DOM is
  // always available here; the guard keeps SSR/typecheck happy.
  if (!item || typeof document === "undefined") return null;

  // Render to <body> so the fixed overlay is relative to the viewport and not
  // trapped inside a transformed ancestor (e.g. the mosaic's reveal animation).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${item.kind === "photo" ? "Photo" : "Video"} by ${item.display_name}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white transition hover:bg-white/20"
      >
        ×
      </button>
      {item.kind === "photo" ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={item.url}
          alt={`Photo by ${item.display_name}`}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        />
      ) : (
        <video
          src={item.url}
          controls
          autoPlay
          playsInline
          onClick={(e) => e.stopPropagation()}
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        />
      )}
    </div>,
    document.body,
  );
}

/**
 * Centered play-button badge used to mark video thumbnails as clickable.
 * Meant to overlay a thumbnail inside a `relative` container.
 */
export function PlayBadge({ size = "md" }: { size?: "sm" | "md" }) {
  const badge = size === "sm" ? "h-9 w-9" : "h-12 w-12";
  const icon = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span
        className={`flex ${badge} items-center justify-center rounded-full bg-black/50 text-white transition group-hover:bg-black/70`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className={`ml-0.5 ${icon}`}
          aria-hidden="true"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </span>
  );
}
