"use client";

import { useCallback, useState } from "react";
import {
  POOL,
  fusedName,
  fusionSpriteUrl,
  pokemonName,
  pokemonSpriteUrl,
  randomPoolId,
} from "@/lib/pokemon";

interface AvatarPickerProps {
  deviceId: string;
  initialHead: number | null;
  initialBody: number | null;
  isDeveloper?: boolean;
  onSaved: (head: number, body: number) => void;
  onCancel: () => void;
}

const ROLLS_PER_SLOT = 3;

function rollDifferent(current: number): number {
  let next = randomPoolId();
  // Re-roll until it changes so each throw feels like something happened.
  for (let i = 0; i < 8 && next === current; i++) next = randomPoolId();
  return next;
}

function Pokeball({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${filled ? "text-[var(--color-accent)]" : "text-[var(--color-border)]"}`}
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity={filled ? 1 : 0.4} />
      <rect x="2" y="11" width="20" height="2" fill="var(--color-background)" />
      <circle cx="12" cy="12" r="3" fill="var(--color-background)" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

const pixelated = { imageRendering: "pixelated" as const };

export function AvatarPicker({
  deviceId,
  initialHead,
  initialBody,
  isDeveloper = false,
  onSaved,
  onCancel,
}: AvatarPickerProps) {
  const [head, setHead] = useState<number>(initialHead ?? randomPoolId());
  const [body, setBody] = useState<number>(initialBody ?? randomPoolId());
  const [headRolls, setHeadRolls] = useState(ROLLS_PER_SLOT);
  const [bodyRolls, setBodyRolls] = useState(ROLLS_PER_SLOT);
  const [mode, setMode] = useState<"gacha" | "grid">("gacha");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (h: number, b: number) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/villager/avatar", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_id: deviceId,
            avatar_head: h,
            avatar_body: b,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Could not save avatar");
        }
        onSaved(h, b);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save avatar");
        setSaving(false);
      }
    },
    [deviceId, onSaved]
  );

  function rollHead() {
    if (headRolls <= 0 || saving) return;
    setHead((c) => rollDifferent(c));
    setHeadRolls((n) => n - 1);
  }

  function rollBody() {
    if (bodyRolls <= 0 || saving) return;
    setBody((c) => rollDifferent(c));
    setBodyRolls((n) => n - 1);
  }

  function skip() {
    if (saving) return;
    save(randomPoolId(), randomPoolId());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-xl"
      >
        <h2 className="text-center text-xl font-bold">Forge your avatar</h2>
        <p className="mt-1 text-center text-sm text-[var(--color-muted)]">
          {mode === "gacha"
            ? "Roll a head and a body to fuse your Pokémon."
            : "Pick a head and a body to fuse."}
        </p>

        {/* Live fused preview */}
        <div className="mt-4 flex flex-col items-center gap-2">
          <div className="flex h-40 w-40 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fusionSpriteUrl(head, body)}
              alt={`${pokemonName(head)} fused with ${pokemonName(body)}`}
              className="h-32 w-32 object-contain"
              style={pixelated}
            />
          </div>
          <span className="text-lg font-bold font-[family-name:var(--font-domaine)]">
            {fusedName(head, body)}
          </span>
        </div>

        {mode === "gacha" ? (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <SlotControl
              label="Head"
              id={head}
              rollsLeft={headRolls}
              onRoll={rollHead}
              disabled={saving}
            />
            <SlotControl
              label="Body"
              id={body}
              rollsLeft={bodyRolls}
              onRoll={rollBody}
              disabled={saving}
            />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <PickGrid
              label="Head"
              selectedId={head}
              onSelect={setHead}
              disabled={saving}
            />
            <PickGrid
              label="Body"
              selectedId={body}
              onSelect={setBody}
              disabled={saving}
            />
          </div>
        )}

        {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:bg-[var(--color-surface)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save(head, body)}
            disabled={saving}
            className="rounded-lg bg-[var(--color-accent)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Keep this fusion"}
          </button>
        </div>

        {isDeveloper && (
          <button
            type="button"
            onClick={() => setMode((m) => (m === "gacha" ? "grid" : "gacha"))}
            className="mt-3 block w-full text-center text-xs text-[var(--color-muted)] underline-offset-4 hover:underline"
          >
            {mode === "gacha" ? "Switch to manual picker" : "Switch to gacha"}
          </button>
        )}

        {/* Subtle skip in the bottom-right: just give me a random one. */}
        {mode === "gacha" && (
          <button
            type="button"
            onClick={skip}
            disabled={saving}
            className="absolute bottom-2 right-3 text-[11px] text-[var(--color-muted)]/70 transition hover:text-[var(--color-muted)] disabled:opacity-50"
          >
            skip…
          </button>
        )}
      </div>
    </div>
  );
}

function SlotControl({
  label,
  id,
  rollsLeft,
  onRoll,
  disabled,
}: {
  label: string;
  id: number;
  rollsLeft: number;
  onRoll: () => void;
  disabled: boolean;
}) {
  const out = rollsLeft <= 0;
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <span className="text-xs font-medium text-[var(--color-muted)]">{label}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pokemonSpriteUrl(id)}
        alt={pokemonName(id) ?? "Pokémon"}
        className="h-14 w-14 object-contain"
        style={pixelated}
      />
      <span className="text-xs font-semibold">{pokemonName(id)}</span>
      <div className="flex gap-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Pokeball key={i} filled={i < rollsLeft} />
        ))}
      </div>
      <button
        type="button"
        onClick={onRoll}
        disabled={disabled || out}
        className="w-full rounded-lg bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
      >
        {out ? "No rolls left" : `Roll (${rollsLeft})`}
      </button>
    </div>
  );
}

function PickGrid({
  label,
  selectedId,
  onSelect,
  disabled,
}: {
  label: string;
  selectedId: number;
  onSelect: (id: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <span className="text-center text-xs font-medium text-[var(--color-muted)]">
        {label}
      </span>
      <div className="grid max-h-44 grid-cols-3 gap-1 overflow-y-auto">
        {POOL.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            disabled={disabled}
            title={p.name}
            className={`flex items-center justify-center rounded-lg border p-1 transition ${
              p.id === selectedId
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                : "border-transparent hover:border-[var(--color-border)]"
            } disabled:opacity-50`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pokemonSpriteUrl(p.id)}
              alt={p.name}
              className="h-10 w-10 object-contain"
              style={pixelated}
              loading="lazy"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
