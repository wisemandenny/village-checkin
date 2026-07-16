"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/motion";
import { ACCEPT, useGalleryUpload } from "@/lib/use-gallery-upload";
import { MediaPreviewer, PlayBadge } from "@/components/gallery/media-previewer";
import { groupByWeek } from "@/lib/gallery-weeks";

interface GalleryItem {
  id: string;
  kind: "photo" | "video";
  url: string;
  display_name: string;
  villager_id: string;
  created_at: string;
}

const PAGE_SIZE = 24;

export function GalleryMosaic({ deviceId }: { deviceId?: string }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [preview, setPreview] = useState<GalleryItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Guard against overlapping page fetches from rapid intersection callbacks.
  const loadingMoreRef = useRef(false);

  const { me, uploading, uploadProgress, error, setError, uploadFiles } =
    useGalleryUpload(deviceId);

  const fetchPage = useCallback(async (before: string | null) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (before) params.set("before", before);
    const res = await fetch(`/api/gallery?${params}`);
    if (!res.ok) {
      return { uploads: [] as GalleryItem[], hasMore: false, nextCursor: null, configured: true };
    }
    const data = await res.json();
    return {
      uploads: (data.uploads ?? []) as GalleryItem[],
      hasMore: Boolean(data.hasMore),
      nextCursor: (data.nextCursor as string | null) ?? null,
      configured: data.configured !== false,
    };
  }, []);

  const loadInitial = useCallback(async () => {
    const page = await fetchPage(null);
    setConfigured(page.configured);
    setItems(page.uploads);
    setHasMore(page.hasMore);
    setNextCursor(page.nextCursor);
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextCursor);
      setItems((cur) => {
        const seen = new Set(cur.map((i) => i.id));
        const appended = page.uploads.filter((u) => !seen.has(u.id));
        return appended.length > 0 ? [...cur, ...appended] : cur;
      });
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, nextCursor]);

  useEffect(() => {
    (async () => {
      await loadInitial();
      setLoading(false);
    })();
  }, [loadInitial]);

  // Lazy-load the next page when the sentinel approaches the viewport.
  // Scroll with the page (not a nested overflow box) so the feed is usable on
  // mobile and inside centered layouts that don't give an inner scroller room.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadMore();
        }
      },
      { root: null, rootMargin: "240px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, items.length]);

  // Uploading is open to any signed-in villager; no check-in is required.
  // `eligible` is kept separate from the in-flight `uploading` flag so the
  // upload UI stays visible (and shows progress) while an upload runs.
  const eligible = Boolean(configured && me);
  const canUpload = eligible && !uploading;

  async function handleFiles(files: File[]) {
    if (files.length === 0 || !canUpload) return;
    const { succeeded } = await uploadFiles(files);
    if (fileRef.current) fileRef.current.value = "";
    if (succeeded > 0) {
      setLoading(true);
      await loadInitial();
      setLoading(false);
    }
  }

  // Nothing to show and no way to contribute: render nothing rather than an
  // empty shell (e.g. uploads unconfigured, or /success with no device id).
  // Use `eligible` (not `canUpload`) so an in-flight upload doesn't hide the UI.
  if (!loading && !configured) return null;
  if (!loading && items.length === 0 && !eligible) return null;

  const weeks = groupByWeek(items);

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

      <div className="mx-auto w-full max-w-3xl">
        {!loading && items.length === 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!canUpload}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/[0.06] px-6 py-8 text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/[0.1] disabled:opacity-40"
          >
            <span className="text-2xl leading-none">+</span>
            <span className="text-sm font-semibold">
              {uploading ? uploadProgress ?? "Uploading…" : "Be the first to share today"}
            </span>
          </button>
        ) : (
          <div className="w-full">
            {/*
              Row height tracks the column width (via container-query units) so
              every tile stays square at any width. Uniform 4-across tiles keep
              the endless feed readable across week sections.
            */}
            <div className="@container space-y-5">
              {weeks.map((week) => (
                <section key={week.key} aria-labelledby={`gallery-week-${week.key}`}>
                  <h3
                    id={`gallery-week-${week.key}`}
                    className="sticky top-0 z-[1] -mx-1 mb-2 bg-[var(--color-background)]/95 px-1 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] backdrop-blur-sm"
                  >
                    {week.label}
                  </h3>
                  <div className="grid grid-cols-8 gap-1.5 [grid-auto-rows:calc((100cqw_-_7_*_0.375rem)_/_8)]">
                    {week.items.map((item) => {
                      const isMine = me?.id === item.villager_id;
                      return (
                        <div
                          key={item.id}
                          className="relative col-span-2 row-span-2 overflow-hidden rounded-lg bg-[var(--color-surface)]"
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
                                <PlayBadge size="sm" />
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
                  </div>
                </section>
              ))}
            </div>

            {hasMore && (
              <div
                ref={sentinelRef}
                className="flex h-10 items-center justify-center text-xs text-[var(--color-muted)]"
                aria-hidden={!loadingMore}
              >
                {loadingMore ? "Loading more…" : null}
              </div>
            )}
          </div>
        )}

        {eligible && items.length > 0 && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[var(--color-accent)] px-6 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-40 font-[family-name:var(--font-domaine)]"
          >
            {uploading ? uploadProgress ?? "Uploading…" : "Upload files"}
          </button>
        )}

        {error && <p className="mt-2 text-center text-sm text-red-500">{error}</p>}
      </div>

      <MediaPreviewer item={preview} onClose={() => setPreview(null)} />
    </Reveal>
  );
}
