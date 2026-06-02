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
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [recoverIg, setRecoverIg] = useState("");
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

    let normalizedIg = igHandle.trim().toLowerCase();
    if (normalizedIg && !normalizedIg.startsWith("@")) {
      normalizedIg = `@${normalizedIg}`;
    }
    setIgHandle(normalizedIg);

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
          marketing_opt_in: marketingOptIn,
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
    if (!recoverIg.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ig_handle: recoverIg.trim().toLowerCase(),
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
          <label htmlFor="recover-ig" className="text-sm font-medium text-[var(--color-muted)]">
            What&apos;s your IG?
          </label>
          <input
            id="recover-ig"
            type="text"
            value={recoverIg}
            onChange={(e) => setRecoverIg(e.target.value.toLowerCase())}
            placeholder="@champagnepapi"
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
          disabled={!recoverIg.trim() || loading}
          className="h-14 rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold font-[family-name:var(--font-domaine)] transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Looking you up..." : "Reconnect"}
        </button>

        <button
          type="button"
          onClick={() => { setMode("register"); setError(null); setRecoverIg(""); }}
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)] transition-colors"
        >
          Never mind, I&apos;m new here
        </button>

        <a
          href="/admin"
          className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)] transition-colors"
        >
          Admin
        </a>
      </form>
    );
  }

  return (
    <form onSubmit={handleRegister} className="flex flex-col gap-6 w-full max-w-sm">
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
          autoFocus
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="ig" className="text-sm font-medium text-[var(--color-muted)]">
          What&apos;s your IG?
        </label>
        <input
          id="ig"
          type="text"
          value={igHandle}
          onChange={(e) => setIgHandle(e.target.value.toLowerCase())}
          placeholder="@champagnepapi"
          className="h-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
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
          What brings you in? <span className="font-normal opacity-60">(pick as many as you want)</span>
        </span>
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => toggleRole(r)}
              className={`h-12 rounded-xl border text-base font-medium transition-all font-[family-name:var(--font-domaine)] ${
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
            What do you play? <span className="font-normal opacity-60">(pick as many as you want)</span>
          </span>
          <div className="grid grid-cols-2 gap-2">
            {INSTRUMENTS.map((inst) => (
              <button
                key={inst}
                type="button"
                onClick={() => toggleInstrument(inst)}
                className={`h-12 rounded-xl border text-base font-medium transition-all font-[family-name:var(--font-domaine)] ${
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

      <button
        type="button"
        onClick={() => setMarketingOptIn((v) => !v)}
        className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-all hover:border-[var(--color-accent)]/40"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-[var(--color-foreground)]">
            Keep me in the loop
          </span>
          <span className="text-xs text-[var(--color-muted)]">
            Get the Village newsletter and updates by email.
          </span>
        </span>
        <span
          aria-hidden
          className={`relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 ${
            marketingOptIn ? "bg-green-500" : "bg-[var(--color-border)]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
              marketingOptIn ? "translate-x-5" : "translate-x-1"
            }`}
          />
        </span>
      </button>

      {error && (
        <p className="text-sm text-red-500 text-center">{error}</p>
      )}

      <button
        type="submit"
        disabled={!displayName.trim() || !email.trim() || loading}
        className="h-14 rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed font-[family-name:var(--font-domaine)]"
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
