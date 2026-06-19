"use client";

import { useCallback, useState } from "react";
import { SelfieCapture } from "@/components/selfie-capture";

interface SelfieModalProps {
  deviceId: string;
  onSaved: (selfieUrl: string) => void;
  onCancel: () => void;
}

// Lets a villager who registered before selfies existed add one from the
// "who's here" page. Wraps the same SelfieCapture used at registration and
// saves the captured data-URL through /api/villager/selfie.
export function SelfieModal({ deviceId, onSaved, onCancel }: SelfieModalProps) {
  const [selfie, setSelfie] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!selfie) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/villager/selfie", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, selfie }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not save selfie");
      }
      const { selfie_url } = await res.json();
      onSaved(selfie_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save selfie");
      setSaving(false);
    }
  }, [deviceId, selfie, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={saving ? undefined : onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-xl"
      >
        <h2 className="text-center text-xl font-bold">Add your selfie</h2>
        <p className="mt-1 text-center text-sm text-[var(--color-muted)]">
          Put a face to your name on the board.
        </p>

        <div className="mt-5">
          <SelfieCapture value={selfie} onChange={setSelfie} />
        </div>

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
            onClick={save}
            disabled={!selfie || saving}
            className="rounded-lg bg-[var(--color-accent)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save selfie"}
          </button>
        </div>
      </div>
    </div>
  );
}
