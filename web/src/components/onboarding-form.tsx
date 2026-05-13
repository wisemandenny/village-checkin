"use client";

import { useState } from "react";
import { setDeviceId } from "@/lib/device-id";

interface OnboardingFormProps {
  deviceId: string;
  onComplete: (displayName: string) => void;
}

const ROLES = ["Producer", "Vocalist", "Engineer", "DJ", "Songwriter", "Just Vibing"];

export function OnboardingForm({ deviceId, onComplete }: OnboardingFormProps) {
  const [mode, setMode] = useState<"register" | "recover">("register");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          display_name: displayName.trim(),
          primary_role: role,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Registration failed");
      }

      onComplete(displayName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          new_device_id: deviceId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Recovery failed");
      }

      // Overwrite localStorage with the (same) device ID now linked to the old account
      setDeviceId(deviceId);
      onComplete(data.villager.display_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "recover") {
    return (
      <form onSubmit={handleRecover} className="flex flex-col gap-8 w-full max-w-sm">
        <div className="flex flex-col gap-2">
          <label htmlFor="recover-name" className="text-sm font-medium text-[var(--color-muted)]">
            What name did you use last time?
          </label>
          <input
            id="recover-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your IG handle or artist name..."
            className="h-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
            autoFocus
            required
          />
        </div>

        {error && (
          <p className="text-sm text-red-500 text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={!displayName.trim() || loading}
          className="h-14 rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Looking you up..." : "Reconnect"}
        </button>

        <button
          type="button"
          onClick={() => { setMode("register"); setError(null); setDisplayName(""); }}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)] transition-colors"
        >
          Never mind, I&apos;m new here
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleRegister} className="flex flex-col gap-8 w-full max-w-sm">
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-sm font-medium text-[var(--color-muted)]">
          What should we call you?
        </label>
        <input
          id="name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="IG handle, artist name, anything..."
          className="h-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
          autoFocus
          required
        />
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium text-[var(--color-muted)]">
          What brings you in?
        </span>
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(role === r ? null : r)}
              className={`h-11 rounded-xl border text-sm font-medium transition-all ${
                role === r
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-accent)]/40"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-500 text-center">{error}</p>
      )}

      <button
        type="submit"
        disabled={!displayName.trim() || loading}
        className="h-14 rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "Setting up..." : "Let's Go"}
      </button>

      <button
        type="button"
        onClick={() => { setMode("recover"); setError(null); setDisplayName(""); }}
        className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)] transition-colors"
      >
        I&apos;ve been here before
      </button>
    </form>
  );
}
