"use client";

import { useState, useCallback } from "react";

interface RecoveryFlowProps {
  deviceId: string;
  onRecovered: (displayName: string) => void;
  onCancel: () => void;
}

interface AttendeeMatch {
  id: string;
  display_name: string;
  primary_role: string | null;
  first_visited_at: string;
}

export function RecoveryFlow({ deviceId, onRecovered, onCancel }: RecoveryFlowProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AttendeeMatch[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const res = await fetch(
        `/api/attendee/search?display_name=${encodeURIComponent(query.trim())}`
      );
      const data = await res.json();
      setResults(data.attendees ?? []);
    } catch {
      setError("Search failed. Try again.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  async function handleClaim(attendee: AttendeeMatch) {
    setClaiming(true);
    setError(null);

    try {
      const res = await fetch("/api/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendee_id: attendee.id,
          new_device_id: deviceId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Recovery failed");
      }

      onRecovered(attendee.display_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setClaiming(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-sm">
      <div className="text-center">
        <h2 className="text-2xl font-bold">Welcome back</h2>
        <p className="mt-1 text-[var(--color-muted)]">
          Search for your name or handle to reconnect
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Your name or IG handle..."
          className="h-12 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-lg placeholder:text-[var(--color-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all"
          autoFocus
        />
        <button
          type="submit"
          disabled={query.trim().length < 2 || loading}
          className="h-12 rounded-xl bg-[var(--color-accent)] px-5 text-white font-medium transition-all hover:bg-[var(--color-accent-light)] disabled:opacity-40"
        >
          {loading ? "..." : "Search"}
        </button>
      </form>

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      {searched && results.length === 0 && !loading && (
        <p className="text-center text-[var(--color-muted)]">
          No profiles found for &ldquo;{query}&rdquo;
        </p>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-[var(--color-muted)]">
            Select your profile
          </span>
          {results.map((a) => (
            <button
              key={a.id}
              onClick={() => handleClaim(a)}
              disabled={claiming}
              className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-all hover:border-[var(--color-accent)]/40 disabled:opacity-40"
            >
              <div>
                <span className="text-lg font-semibold">{a.display_name}</span>
                {a.primary_role && (
                  <span className="ml-2 text-sm text-[var(--color-muted)]">
                    {a.primary_role}
                  </span>
                )}
              </div>
              <span className="text-xs text-[var(--color-muted)]">
                Since {formatDate(a.first_visited_at)}
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onCancel}
        className="text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-foreground)] transition-colors"
      >
        I&apos;m new here
      </button>
    </div>
  );
}
