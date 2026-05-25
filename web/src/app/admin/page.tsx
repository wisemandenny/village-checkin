"use client";

import { useState, useEffect, FormEvent } from "react";
import VillagersPanel from "@/components/admin/villagers-panel";
import CheckInsPanel from "@/components/admin/checkins-panel";
import SettingsPanel from "@/components/admin/settings-panel";

type Tab = "villagers" | "checkins" | "settings";

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("villagers");

  useEffect(() => {
    const saved = sessionStorage.getItem("admin_token");
    if (saved) setToken(saved);
  }, []);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      const res = await fetch("/api/admin/villagers?search=__ping__", {
        headers: { Authorization: `Bearer ${passwordInput}` },
      });
      if (!res.ok) throw new Error("Invalid password");
      sessionStorage.setItem("admin_token", passwordInput);
      setToken(passwordInput);
    } catch {
      setLoginError("Invalid password. Please try again.");
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("admin_token");
    setToken(null);
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-lg"
        >
          <h1 className="mb-1 text-2xl font-bold">Admin Panel</h1>
          <p className="mb-6 text-sm text-[var(--color-muted)]">
            Enter the admin password to continue.
          </p>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="Password"
            autoFocus
            className="mb-4 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
          />
          {loginError && (
            <p className="mb-3 text-sm text-red-500">{loginError}</p>
          )}
          <button
            type="submit"
            disabled={loggingIn || !passwordInput}
            className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
          >
            {loggingIn ? "Signing in…" : "Sign In"}
          </button>
          <a
            href="/"
            className="mt-4 block text-center text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
          >
            &larr; Back to check-in
          </a>
        </form>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "villagers", label: "Villagers" },
    { key: "checkins", label: "Check-ins" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Top bar */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] transition hover:bg-[var(--color-surface)]"
        >
          Logout
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? "bg-[var(--color-background)] text-[var(--color-foreground)] shadow-sm"
                : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active panel */}
      {activeTab === "villagers" && <VillagersPanel token={token} />}
      {activeTab === "checkins" && <CheckInsPanel token={token} />}
      {activeTab === "settings" && <SettingsPanel token={token} />}
    </div>
  );
}
