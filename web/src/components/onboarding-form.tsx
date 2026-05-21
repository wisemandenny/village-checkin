"use client";

import { useState } from "react";
import { setDeviceId } from "@/lib/device-id";

interface OnboardingFormProps {
  deviceId: string;
  onComplete: (displayName: string) => void;
}

const ROLES = ["Producer", "Vocalist", "Musician", "Just Vibing"] as const;

const INSTRUMENTS = [
  "Keys",
  "Guitar",
  "Bass",
  "Percussion",
  "Saxophone",
  "Violin",
  "Other",
] as const;

export function OnboardingForm({ deviceId, onComplete }: OnboardingFormProps) {
  const [mode, setMode] = useState<"register" | "recover">("register");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [igHandle, setIgHandle] = useState("");
  const [roles, setRoles] = useState<Set<string>>(new Set());
  const [instruments, setInstruments] = useState<Set<string>>(new Set());
  const [otherInstrument, setOtherInstrument] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(role: string) {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
        if (role === "Musician") {
          setInstruments(new Set());
          setOtherInstrument("");
        }
      } else {
        next.add(role);
      }
      return next;
    });
  }

  function toggleInstrument(inst: string) {
    setInstruments((prev) => {
      const next = new Set(prev);
      if (next.has(inst)) {
        next.delete(inst);
        if (inst === "Other") setOtherInstrument("");
      } else {
        next.add(inst);
      }
      return next;
    });
  }

  function buildInstrumentsList(): string[] {
    const list: string[] = [];
    for (const inst of instruments) {
      if (inst === "Other") {
        const trimmed = otherInstrument.trim();
        if (trimmed) list.push(trimmed);
      } else {
        list.push(inst);
      }
    }
    return list;
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;

    setLoading(true);
    setError(null);

    let normalizedIg = igHandle.trim();
    if (normalizedIg && !normalizedIg.startsWith("@")) {
      normalizedIg = `@${normalizedIg}`;
      setIgHandle(normalizedIg);
    }

    try {
      const finalInstruments = roles.has("Musician")
        ? buildInstrumentsList()
        : [];

      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          display_name: displayName.trim(),
          email: email.trim(),
          ig_handle: normalizedIg || undefined,
          roles: [...roles],
          instruments: finalInstruments.length ? finalInstruments : undefined,
        }),
      });

      if (!res.ok) {
        let message = "Registration failed";
        try {
          const data = await res.json();
          message = data.error || message;
        } catch {
          message = `Server error (${res.status})`;
        }
        throw new Error(message);
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
    <form onSubmit={handleRegister} className="flex flex-col gap-6 w-full max-w-sm">
      <div className="flex flex-col gap-2">
        <label htmlFor="ig" className="text-sm font-medium text-[var(--color-muted)]">
          IG Handle
        </label>
        <input
          id="ig"
          type="text"
          value={igHandle}
          onChange={(e) => setIgHandle(e.target.value)}
          placeholder="@yourhandle"
          className="h-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-sm font-medium text-[var(--color-muted)]">
          What should we call you?
        </label>
        <input
          id="name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name or artist name..."
          className="h-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium text-[var(--color-muted)]">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="h-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
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
              onClick={() => toggleRole(r)}
              className={`h-11 rounded-xl border text-sm font-medium transition-all ${
                roles.has(r)
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-accent)]/40"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {roles.has("Musician") && (
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium text-[var(--color-muted)]">
            What do you play?
          </span>
          <div className="grid grid-cols-2 gap-2">
            {INSTRUMENTS.map((inst) => (
              <button
                key={inst}
                type="button"
                onClick={() => toggleInstrument(inst)}
                className={`h-11 rounded-xl border text-sm font-medium transition-all ${
                  instruments.has(inst)
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-accent)]/40"
                }`}
              >
                {inst}
              </button>
            ))}
          </div>

          {instruments.has("Other") && (
            <input
              type="text"
              value={otherInstrument}
              onChange={(e) => setOtherInstrument(e.target.value)}
              placeholder="What instrument?"
              className="h-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
            />
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-500 text-center">{error}</p>
      )}

      <button
        type="submit"
        disabled={!displayName.trim() || !email.trim() || loading}
        className="h-14 rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "Setting up..." : "Register"}
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
