"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Reveal } from "@/components/motion";
import { ACCEPT, useGalleryUpload } from "@/lib/use-gallery-upload";
import { MediaPreviewer, PlayBadge } from "@/components/gallery/media-previewer";

interface MosaicItem {
  id: string;
  kind: "photo" | "video";
  url: string;
  display_name: string;
  villager_id: string;
  created_at: string;
  promoted: boolean;
}

// How many tiles get the larger 2x2 "highlighted" treatment. The mosaic feed
// returns promoted-first then recency, so the first slice is already the right
// set: promoted items fill highlights first, recency fills the remainder.
const HIGHLIGHT_SLOTS = 2;

export function GalleryMosaic({ deviceId }: { deviceId?: string }) {
  const [items, setItems] = useState<MosaicItem[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<MosaicItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { me, uploading, uploadProgress, error, setError, uploadFiles } =
    useGalleryUpload(deviceId);

  const loadMosaic = useCallback(async () => {
    const res = await fetch("/api/gallery?scope=mosaic");
    if (res.ok) {
      const data = await res.json();
      setConfigured(data.configured !== false);
      setItems(data.uploads ?? []);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadMosaic();
      setLoading(false);
    })();
  }, [loadMosaic]);

  // Uploading is open to any signed-in villager; no check-in is required.
  const canUpload = Boolean(configured && me && !uploading);

  async function handleFiles(files: File[]) {
    if (files.length === 0 || !canUpload) return;
    const { succeeded } = await uploadFiles(files);
    if (fileRef.current) fileRef.current.value = "";
    if (succeeded > 0) {
      await loadMosaic();
    }
  }

  // Nothing to show and no way to contribute: render nothing rather than an
  // empty shell (e.g. uploads unconfigured, or /success with no device id).
  if (!loading && !configured) return null;
  if (!loading && items.length === 0 && !canUpload) return null;

  const highlights = items.slice(0, HIGHLIGHT_SLOTS);
  const highlightIds = new Set(highlights.map((i) => i.id));

  return (
    <Reveal delay={320} className="w-full">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        disabled={uploading}
        onChange={(e) => {
          setError(null);
          void handleFiles(Array.from(e.target.files ?? []));
        }}
        className="hidden"
      />

      <div className="mx-auto w-full max-w-sm">
        {!loading && items.length === 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!canUpload}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/[0.06] px-6 py-8 text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/[0.1] disabled:opacity-40"
          >
            <span className="text-2xl leading-none">+</span>
            <span className="text-sm font-semibold">Be the first to share today</span>
          </button>
        ) : (
          <div className="grid grid-flow-row-dense grid-cols-4 gap-1.5 [grid-auto-rows:90px]">
            {items.map((item) => {
              const isHighlight = highlightIds.has(item.id);
              const isMine = me?.id === item.villager_id;
              return (
                <div
                  key={item.id}
                  className={`relative overflow-hidden rounded-lg bg-[var(--color-surface)] ${
                    isHighlight ? "col-span-4 row-span-4" : "col-span-2 row-span-2"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setPreview(item)}
                    className="group h-full w-full cursor-zoom-in"
                    aria-label={`Open ${item.kind} by ${item.display_name}`}
                  >
                    {item.kind === "photo" ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={item.url}
                        alt={`Photo by ${item.display_name}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <>
                        <video
                          src={item.url}
                          preload="metadata"
                          muted
                          playsInline
                          className="h-full w-full object-cover"
                        />
                        <PlayBadge size={isHighlight ? "md" : "sm"} />
                      </>
                    )}
                  </button>
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-3 text-[10px] font-medium text-white">
                    {item.display_name}
                    {isMine && " (you)"}
                  </span>
                </div>
              );
            })}

            {canUpload && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="col-span-2 row-span-2 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/[0.06] text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/[0.1] disabled:opacity-40"
                aria-label="Add your photo"
              >
                <span className="text-2xl leading-none">+</span>
                <span className="text-xs font-semibold leading-tight">Add yours</span>
              </button>
            )}
          </div>
        )}

        {canUpload && items.length > 0 && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[var(--color-accent)] px-6 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-40 font-[family-name:var(--font-domaine)]"
          >
            {uploading ? uploadProgress ?? "Uploading…" : "Add your photo"}
          </button>
        )}

        {error && <p className="mt-2 text-center text-sm text-red-500">{error}</p>}

        {items.length > 0 && (
          <div className="mt-2 text-center">
            <Link
              href="/gallery"
              className="text-xs text-[var(--color-muted)] underline-offset-4 transition hover:text-[var(--color-foreground)] hover:underline"
            >
              Open full gallery →
            </Link>
          </div>
        )}
      </div>

      <MediaPreviewer item={preview} onClose={() => setPreview(null)} />
    </Reveal>
  );
}
