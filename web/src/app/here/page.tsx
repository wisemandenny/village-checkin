"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getDeviceId } from "@/lib/device-id";
import { fusedName, fusionSpriteUrl, pokemonName } from "@/lib/pokemon";
import { AvatarPicker } from "@/components/avatar-picker";
import { SelfieModal } from "@/components/selfie-modal";

interface BoardVillager {
  id: string;
  display_name: string;
  avatar_head: number | null;
  avatar_body: number | null;
  selfie_url: string | null;
}

interface Me {
  id: string;
  display_name: string;
  roles: string[] | null;
  avatar_head: number | null;
  avatar_body: number | null;
  selfie_url: string | null;
}

const pixelated = { imageRendering: "pixelated" as const };

export default function HerePage() {
  const [villagers, setVillagers] = useState<BoardVillager[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [revealedId, setRevealedId] = useState<string | null>(null);

  const loadBoard = useCallback(async () => {
    const res = await fetch("/api/here");
    if (res.ok) {
      const { villagers } = await res.json();
      setVillagers(villagers ?? []);
    }
  }, []);

  useEffect(() => {
    const deviceId = getDeviceId();
    (async () => {
      const tasks: Promise<unknown>[] = [loadBoard()];
      if (deviceId) {
        tasks.push(
          fetch(`/api/villager?device_id=${encodeURIComponent(deviceId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data?.villager) setMe(data.villager as Me);
            })
            .catch(() => {})
        );
      }
      await Promise.all(tasks);
      setLoading(false);
    })();
  }, [loadBoard]);

  const deviceId = getDeviceId();
  const isDeveloper = (me?.roles ?? []).includes("developer");
  const hasAvatar = me?.avatar_head != null && me?.avatar_body != null;
  const hasSelfie = !!me?.selfie_url;

  // Always show yourself, even if the board feed excludes you (e.g. a test or
  // dev account, or a check-in that isn't paid/skipped). `me` is also the
  // freshest source for your own avatar right after saving.
  const displayVillagers = useMemo<BoardVillager[]>(() => {
    if (!me) return villagers;
    const mine: BoardVillager = {
      id: me.id,
      display_name: me.display_name,
      avatar_head: me.avatar_head,
      avatar_body: me.avatar_body,
      selfie_url: me.selfie_url,
    };
    const rest = villagers.filter((v) => v.id !== me.id);
    return [mine, ...rest];
  }, [villagers, me]);

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col items-center">
        <h1 className="text-center text-2xl font-bold font-[family-name:var(--font-domaine)]">
          In the Village tonight
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {loading
            ? "Loading…"
            : `${displayVillagers.length} here`}
        </p>

        {me && !hasSelfie && (
          <button
            type="button"
            onClick={() => setSelfieOpen(true)}
            className="mt-5 flex items-center gap-2 rounded-2xl bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-white shadow-lg shadow-[var(--color-accent)]/30 transition hover:bg-[var(--color-accent-light)] font-[family-name:var(--font-domaine)]"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
            Add your selfie
          </button>
        )}

        {me && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="mt-4 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)]"
          >
            {hasAvatar ? "Edit your avatar" : "Forge your avatar"}
          </button>
        )}

        {!loading && displayVillagers.length === 0 && (
          <p className="mt-10 text-center text-sm text-[var(--color-muted)]">
            No one’s here yet tonight.
          </p>
        )}

        <div className="mt-8 grid w-full grid-cols-3 gap-3 sm:grid-cols-4">
          {displayVillagers.map((v) => {
            const isMe = me?.id === v.id;
            const set = v.avatar_head != null && v.avatar_body != null;
            const hasSelfie = !!v.selfie_url;
            const revealed = revealedId === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  if (isMe) {
                    setPickerOpen(true);
                  } else if (set && !hasSelfie) {
                    setRevealedId((cur) => (cur === v.id ? null : v.id));
                  }
                }}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-2 text-center transition ${
                  isMe
                    ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30"
                    : "border-[var(--color-border)]"
                }`}
              >
                <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-[var(--color-surface)] p-1">
                  {hasSelfie ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={v.selfie_url!}
                      alt={`${v.display_name}'s selfie`}
                      className="h-full w-full rounded-xl object-cover"
                      loading="lazy"
                    />
                  ) : set ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={fusionSpriteUrl(v.avatar_head!, v.avatar_body!)}
                      alt={`${v.display_name}'s avatar`}
                      className="h-full w-full object-contain"
                      style={pixelated}
                      loading="lazy"
                    />
                  ) : (
                    <PlaceholderAvatar />
                  )}
                </div>
                <span className="line-clamp-1 text-xs font-semibold">
                  {v.display_name}
                  {isMe && " (you)"}
                </span>
                {revealed && set && !hasSelfie && (
                  <span className="flex flex-col leading-tight text-[var(--color-muted)]">
                    <span className="text-[11px] font-semibold text-[var(--color-foreground)]">
                      {fusedName(v.avatar_head!, v.avatar_body!)}
                    </span>
                    <span className="text-[10px]">
                      {pokemonName(v.avatar_head!)} × {pokemonName(v.avatar_body!)}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <Link
          href="/"
          className="mt-10 text-xs text-[var(--color-muted)] underline-offset-4 transition hover:text-[var(--color-foreground)] hover:underline"
        >
          ← back
        </Link>
      </div>

      {pickerOpen && deviceId && (
        <AvatarPicker
          deviceId={deviceId}
          initialHead={me?.avatar_head ?? null}
          initialBody={me?.avatar_body ?? null}
          isDeveloper={isDeveloper}
          onSaved={(head, body) => {
            setMe((cur) => (cur ? { ...cur, avatar_head: head, avatar_body: body } : cur));
            setPickerOpen(false);
            loadBoard();
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}

      {selfieOpen && deviceId && (
        <SelfieModal
          deviceId={deviceId}
          onSaved={(selfieUrl) => {
            setMe((cur) => (cur ? { ...cur, selfie_url: selfieUrl } : cur));
            setSelfieOpen(false);
            loadBoard();
          }}
          onCancel={() => setSelfieOpen(false)}
        />
      )}
    </main>
  );
}

function PlaceholderAvatar() {
  return (
    <svg viewBox="0 0 24 24" className="h-3/4 w-3/4 text-[var(--color-border)]" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <rect x="2" y="11" width="20" height="2" fill="var(--color-surface)" />
      <circle cx="12" cy="12" r="3" fill="var(--color-surface)" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
