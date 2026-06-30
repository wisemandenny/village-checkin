"use client";

import { useEffect, useRef, useState } from "react";
import { setDeviceId } from "@/lib/device-id";
import { ROLE_ORDER, INSTRUMENT_ORDER, Role } from "@/lib/tag-order";
import { SelfieCapture } from "@/components/selfie-capture";
import {
  Reveal,
  Stagger,
  Collapse,
  Spinner,
  useAnimationEnabled,
} from "@/components/motion";

interface OnboardingFormProps {
  deviceId: string;
  onComplete: (displayName: string, isNewRegistration: boolean) => void;
}

const ROLES = ROLE_ORDER;

// "Other" is replaced by the free-form custom-instrument badges below, so it is
// filtered out of the preset buttons.
const INSTRUMENTS = INSTRUMENT_ORDER.filter((inst) => inst !== "Other");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OnboardingForm({ deviceId, onComplete }: OnboardingFormProps) {
  const [mode, setMode] = useState<"choose" | "register" | "recover">("choose");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [igHandle, setIgHandle] = useState("");
  const [roles, setRoles] = useState<Set<string>>(new Set());
  const [instruments, setInstruments] = useState<Set<string>>(new Set());
  // Stable ids keep each editable badge's identity across add/remove so inputs
  // don't lose focus or value when a sibling is removed.
  const [customInstruments, setCustomInstruments] = useState<{ id: number; value: string }[]>([]);
  const nextCustomId = useRef(0);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [recoverIg, setRecoverIg] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped per request so a slow, stale response can't overwrite a newer one.
  const suggestSeq = useRef(0);
  // The existing handle (e.g. "@drake") a typed IG matches in register mode, so
  // we can nudge the villager to reconnect before they fill out the whole form
  // and hit a submit-time 409.
  const [igTaken, setIgTaken] = useState<string | null>(null);
  const igCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const igCheckSeq = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const animEnabled = useAnimationEnabled();

  useEffect(() => {
    return () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
      if (igCheckTimer.current) clearTimeout(igCheckTimer.current);
    };
  }, []);

  function clearSuggestions() {
    if (suggestTimer.current) {
      clearTimeout(suggestTimer.current);
      suggestTimer.current = null;
    }
    suggestSeq.current++;
    setSuggestions([]);
  }

  function onRecoverIgChange(raw: string) {
    const value = raw.toLowerCase();
    setRecoverIg(value);

    if (suggestTimer.current) clearTimeout(suggestTimer.current);

    // Mirror the server's gate: ignore the leading "@" and require 2+ chars.
    const prefix = value.startsWith("@") ? value.slice(1) : value;
    if (prefix.length < 2) {
      suggestSeq.current++;
      setSuggestions([]);
      return;
    }

    const seq = ++suggestSeq.current;
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/recover/suggest?q=${encodeURIComponent(value)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        // Drop the response if a newer request has since started.
        if (seq !== suggestSeq.current) return;
        setSuggestions(Array.isArray(data.handles) ? data.handles : []);
      } catch {
        // Transient errors just leave the prior suggestions in place.
      }
    }, 200);
  }

  function pickSuggestion(handle: string) {
    setRecoverIg(handle);
    clearSuggestions();
  }

  // While registering, watch the IG field for a handle that's already taken so
  // we can surface a "reconnect instead" nudge before the form is submitted.
  // Reuses the recover suggestion endpoint (prefix match) and looks for an
  // exact, case-insensitive hit among the returned handles.
  function onRegisterIgChange(raw: string) {
    const value = raw.toLowerCase();
    setIgHandle(value);
    setIgTaken(null);

    if (igCheckTimer.current) clearTimeout(igCheckTimer.current);

    // Mirror the server's gate: ignore the leading "@" and require 2+ chars.
    const prefix = value.startsWith("@") ? value.slice(1) : value;
    if (prefix.length < 2) {
      igCheckSeq.current++;
      return;
    }

    const normalized = `@${prefix}`;
    const seq = ++igCheckSeq.current;
    igCheckTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/recover/suggest?q=${encodeURIComponent(normalized)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        // Drop the response if a newer keystroke has since started.
        if (seq !== igCheckSeq.current) return;
        const handles: string[] = Array.isArray(data.handles) ? data.handles : [];
        const match = handles.find((h) => h.toLowerCase() === normalized);
        if (match) setIgTaken(match);
      } catch {
        // Transient errors just leave no notice; submit-time 409 still covers it.
      }
    }, 200);
  }

  // Shared entry into recovery mode, optionally pre-filling the IG handle (used
  // by the "reconnect" nudge so the villager doesn't have to retype it).
  function switchToRecover(prefillIg?: string) {
    if (igCheckTimer.current) clearTimeout(igCheckTimer.current);
    igCheckSeq.current++;
    setMode("recover");
    setError(null);
    setDisplayName("");
    setIgTaken(null);
    if (prefillIg) setRecoverIg(prefillIg);
  }

  // "First time?" entry: open the full registration form.
  function switchToRegister() {
    setMode("register");
    setError(null);
  }

  // Return to the landing choice, clearing any in-progress recover input and
  // pending suggestion/duplicate lookups so the two paths don't leak state.
  function backToChoose() {
    if (igCheckTimer.current) clearTimeout(igCheckTimer.current);
    igCheckSeq.current++;
    clearSuggestions();
    setMode("choose");
    setError(null);
    setRecoverIg("");
    setIgTaken(null);
  }

  const isEmailValid = EMAIL_RE.test(email.trim());

  function toggleRole(role: string) {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
        if (role === Role.Musician) {
          setInstruments(new Set());
          setCustomInstruments([]);
        }
      } else if (role === Role.JustVibing) {
        // "Just Vibing" is exclusive: selecting it clears every other role
        // (and any instruments that came with Musician).
        next.clear();
        next.add(role);
        setInstruments(new Set());
        setCustomInstruments([]);
      } else {
        // Selecting an active-participation role drops the exclusive "Just Vibing".
        next.delete(Role.JustVibing);
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
      } else {
        next.add(inst);
      }
      return next;
    });
  }

  function addCustomInstrument() {
    setCustomInstruments((prev) => [...prev, { id: nextCustomId.current++, value: "" }]);
  }

  function updateCustomInstrument(id: number, value: string) {
    setCustomInstruments((prev) => prev.map((item) => (item.id === id ? { ...item, value } : item)));
  }

  function removeCustomInstrument(id: number) {
    setCustomInstruments((prev) => prev.filter((item) => item.id !== id));
  }

  function buildInstrumentsList(): string[] {
    const list: string[] = [...instruments];
    for (const custom of customInstruments) {
      const trimmed = custom.value.trim();
      if (trimmed) list.push(trimmed);
    }
    return list;
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    if (!isEmailValid) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    setError(null);

    let normalizedIg = igHandle.trim().toLowerCase();
    if (normalizedIg && !normalizedIg.startsWith("@")) {
      normalizedIg = `@${normalizedIg}`;
    }
    setIgHandle(normalizedIg);

    try {
      const finalInstruments = roles.has(Role.Musician)
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
          selfie: selfie || undefined,
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

      onComplete(displayName.trim(), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    if (!recoverIg.trim()) return;

    clearSuggestions();
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
      onComplete(data.villager.display_name, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "choose") {
    return (
      <Reveal className="w-full max-w-sm">
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={switchToRegister}
            className="flex h-16 w-full flex-col items-center justify-center rounded-2xl bg-[var(--color-accent)] text-white transition-all hover:bg-[var(--color-accent-light)] active:scale-[0.98]"
          >
            <span className="text-lg font-semibold font-[family-name:var(--font-domaine)]">First time?</span>
            <span className="text-xs text-white/80">Join the Village</span>
          </button>
          <button
            type="button"
            onClick={() => switchToRecover()}
            className="flex h-16 w-full flex-col items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] transition-all hover:border-[var(--color-accent)]/60 active:scale-[0.98]"
          >
            <span className="text-lg font-semibold font-[family-name:var(--font-domaine)]">Long time</span>
            <span className="text-xs text-[var(--color-muted)]">Link your account to this device</span>
          </button>
        </div>
      </Reveal>
    );
  }

  if (mode === "recover") {
    return (
      <Reveal className="w-full max-w-sm">
        <form onSubmit={handleRecover} className="flex flex-col gap-8 w-full">
          <div className="flex flex-col gap-2">
            <label htmlFor="recover-ig" className="text-sm font-medium text-[var(--color-muted)]">
              What&apos;s your IG?
            </label>
            <div className="relative">
              <input
                id="recover-ig"
                type="text"
                value={recoverIg}
                onChange={(e) => onRecoverIgChange(e.target.value)}
                placeholder="@champagnepapi"
                autoComplete="off"
                className="h-12 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
                autoFocus
                required
              />
              {suggestions.length > 0 && !suggestions.includes(recoverIg) && (
                <ul className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
                  {suggestions.map((handle) => (
                    <li key={handle}>
                      <button
                        type="button"
                        onClick={() => pickSuggestion(handle)}
                        className="block w-full px-4 py-3 text-left text-base text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]"
                      >
                        {handle}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {error && (
            <p className={`text-sm text-red-500 text-center ${animEnabled ? "anim-shake" : ""}`}>{error}</p>
          )}

          <button
            type="submit"
            disabled={!recoverIg.trim() || loading}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold font-[family-name:var(--font-domaine)] transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading && <Spinner />}
            {loading ? "Looking you up..." : "Enter"}
          </button>

          <button
            type="button"
            onClick={backToChoose}
            className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)] transition-colors"
          >
            Back
          </button>
        </form>
      </Reveal>
    );
  }

  return (
    <form onSubmit={handleRegister} className="flex flex-col gap-6 w-full max-w-sm">
      <Stagger step={70}>
        <Reveal className="flex flex-col gap-2">
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
        </Reveal>

        <Reveal className="flex flex-col gap-2">
          <label htmlFor="ig" className="text-sm font-medium text-[var(--color-muted)]">
            What&apos;s your IG?
          </label>
          <input
            id="ig"
            type="text"
            value={igHandle}
            onChange={(e) => onRegisterIgChange(e.target.value)}
            placeholder="@champagnepapi"
            className="h-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
          />
          {igTaken && (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-3">
              <p className="text-sm text-[var(--color-foreground)]">
                Looks like <span className="font-semibold">{igTaken}</span> is already registered.
              </p>
              <button
                type="button"
                onClick={() => switchToRecover(igTaken)}
                className="text-sm font-semibold text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-accent-light)] transition-colors"
              >
                Reconnect my account
              </button>
            </div>
          )}
        </Reveal>

        <Reveal className="flex flex-col gap-2">
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
          {email.trim() && !isEmailValid && (
            <p className="text-xs text-red-500">Please enter a valid email address.</p>
          )}
        </Reveal>

        <Reveal className="flex flex-col gap-3">
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
                  animEnabled ? "chip-anim active:scale-95 " : ""
                }${
                  roles.has(r)
                    ? `border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] ${animEnabled ? "anim-pop" : ""}`
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-accent)]/40"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </Reveal>

        <Reveal>
          <Collapse show={roles.has("Musician")}>
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
                      animEnabled ? "chip-anim active:scale-95 " : ""
                    }${
                      instruments.has(inst)
                        ? `border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] ${animEnabled ? "anim-pop" : ""}`
                        : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-accent)]/40"
                    }`}
                  >
                    {inst}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addCustomInstrument}
                  aria-label="Add another instrument"
                  className="flex h-12 items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] transition-all hover:border-[var(--color-accent)]/60 hover:text-[var(--color-accent)]"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" />
                  </svg>
                </button>
              </div>

              {customInstruments.length > 0 && (
                <div className="flex flex-col gap-2">
                  {customInstruments.map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item.value}
                        onChange={(e) => updateCustomInstrument(item.id, e.target.value)}
                        placeholder="What instrument?"
                        autoFocus
                        className="h-12 flex-1 rounded-xl border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-4 text-base text-[var(--color-accent)] placeholder:text-[var(--color-accent)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => removeCustomInstrument(item.id)}
                        aria-label="Remove instrument"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] transition-all hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Collapse>
        </Reveal>

        <Reveal>
          <button
            type="button"
            onClick={() => setMarketingOptIn((v) => !v)}
            className="flex w-full items-start justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-all hover:border-[var(--color-accent)]/40"
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
        </Reveal>

        <Reveal>
          <SelfieCapture value={selfie} onChange={setSelfie} />
        </Reveal>

        {error && (
          <p className={`text-sm text-red-500 text-center ${animEnabled ? "anim-shake" : ""}`}>{error}</p>
        )}

        <Reveal>
          <button
            type="submit"
            disabled={!displayName.trim() || !isEmailValid || loading}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--color-accent)] text-white text-lg font-semibold transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed font-[family-name:var(--font-domaine)]"
          >
            {loading && <Spinner />}
            {loading ? "Setting up..." : "Enter"}
          </button>
        </Reveal>

        <Reveal>
          <button
            type="button"
            onClick={backToChoose}
            className="w-full text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)] transition-colors"
          >
            Back
          </button>
        </Reveal>
      </Stagger>
    </form>
  );
}
