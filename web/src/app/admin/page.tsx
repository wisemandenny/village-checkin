"use client";

import { useState, useSyncExternalStore, FormEvent } from "react";
import Link from "next/link";
import VillagersPanel from "@/components/admin/villagers-panel";
import CheckInsPanel from "@/components/admin/checkins-panel";
import SubscriptionsPanel from "@/components/admin/subscriptions-panel";
import SettingsPanel from "@/components/admin/settings-panel";
import ChangelogPanel from "@/components/admin/changelog-panel";
import GalleryPanel from "@/components/admin/gallery-panel";
import StatisticsPanel from "@/components/admin/statistics-panel";
import { ThemeToggleButton } from "@/components/theme-toggle";

type Tab = "villagers" | "checkins" | "subscriptions" | "statistics" | "gallery" | "settings" | "changelog";

// The admin session token is persisted in localStorage so admins stay logged in
// across tab/browser restarts. We treat localStorage as an external store and
// read it with useSyncExternalStore instead of seeding state from an effect.
const TOKEN_KEY = "admin_token";
const TOKEN_EVENT = "admin-token-change";

function subscribeToken(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(TOKEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(TOKEN_EVENT, onChange);
  };
}

function getTokenSnapshot(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setStoredToken(token: string | null) {
  if (token === null) {
    localStorage.removeItem(TOKEN_KEY);
  } else {
    localStorage.setItem(TOKEN_KEY, token);
  }
  window.dispatchEvent(new Event(TOKEN_EVENT));
}

const leftTabs: { key: Tab; label: string }[] = [
  { key: "villagers", label: "Villagers" },
  { key: "checkins", label: "Check-ins" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "statistics", label: "Statistics" },
  { key: "gallery", label: "Gallery" },
];

export default function AdminPage() {
  const token = useSyncExternalStore(subscribeToken, getTokenSnapshot, () => null);
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("villagers");

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      const res = await fetch("/api/admin/villagers?search=__ping__", {
        headers: { Authorization: `Bearer ${passwordInput}` },
      });
      if (!res.ok) throw new Error("Invalid password");
      setStoredToken(passwordInput);
    } catch {
      setLoginError("Invalid password. Please try again.");
    } finally {
      setLoggingIn(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <ThemeToggleButton className="fixed left-4 top-4 z-50" />
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
          <Link
            href="/"
            className="mt-4 block text-center text-sm text-[var(--color-muted)] underline underline-offset-4 transition hover:text-[var(--color-foreground)]"
          >
            &larr; Back to check-in
          </Link>
        </form>
      </div>
    );
  }

  const tabClass = (key: Tab) =>
    `shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition ${
      activeTab === key
        ? "bg-[var(--color-background)] text-[var(--color-foreground)] shadow-sm"
        : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
    }`;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Top bar */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <div className="flex items-center gap-2">
          <ThemeToggleButton />
          <Link
            href="/"
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] transition hover:bg-[var(--color-surface)]"
          >
            Back to Check-in
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-1 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        {leftTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={tabClass(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <div className="hidden flex-1 sm:block" />
        <button
          onClick={() => setActiveTab("settings")}
          className={`${tabClass("settings")} inline-flex items-center gap-1.5`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7 7 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a7 7 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a7 7 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a7 7 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
      </div>

      {/* Active panel */}
      {activeTab === "villagers" && <VillagersPanel token={token} />}
      {activeTab === "checkins" && <CheckInsPanel token={token} />}
      {activeTab === "subscriptions" && <SubscriptionsPanel token={token} />}
      {activeTab === "statistics" && <StatisticsPanel token={token} />}
      {activeTab === "gallery" && <GalleryPanel token={token} />}
      {activeTab === "settings" && <SettingsPanel token={token} onShowChangelog={() => setActiveTab("changelog")} />}
      {activeTab === "changelog" && <ChangelogPanel />}
    </div>
  );
}
