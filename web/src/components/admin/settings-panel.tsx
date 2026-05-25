"use client";

import { useState, useEffect, FormEvent } from "react";

interface SettingsPanelProps {
  token: string;
  onShowChangelog?: () => void;
}

export default function SettingsPanel({ token, onShowChangelog }: SettingsPanelProps) {
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [hasDbPassword, setHasDbPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setPaymentsEnabled(data.payments_enabled === true);
      setHasDbPassword(data.admin_password === "(set)");
    } catch {
      setMessage({ type: "error", text: "Failed to load settings" });
    } finally {
      setLoading(false);
    }
  }

  async function togglePayments() {
    const newValue = !paymentsEnabled;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: "payments_enabled", value: newValue }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setPaymentsEnabled(newValue);
      setMessage({ type: "success", text: `Payments ${newValue ? "enabled" : "disabled"}` });
    } catch {
      setMessage({ type: "error", text: "Failed to update setting" });
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    setPasswordMessage(null);

    if (!newPassword.trim()) {
      setPasswordMessage({ type: "error", text: "Password cannot be empty" });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: "error", text: "Passwords do not match" });
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMessage({ type: "error", text: "Password must be at least 6 characters" });
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: "admin_password", value: newPassword }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setHasDbPassword(true);
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage({ type: "success", text: "Password updated. Use your new password next time you log in." });
    } catch {
      setPasswordMessage({ type: "error", text: "Failed to update password" });
    } finally {
      setPasswordSaving(false);
    }
  }

  async function resetToEnvPassword() {
    setPasswordSaving(true);
    setPasswordMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: "admin_password", value: null }),
      });
      if (!res.ok) throw new Error("Failed to reset");
      setHasDbPassword(false);
      setPasswordMessage({ type: "success", text: "Password reset to environment variable default" });
    } catch {
      setPasswordMessage({ type: "error", text: "Failed to reset password" });
    } finally {
      setPasswordSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[var(--color-muted)]">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Payments toggle */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Payments</h3>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              When enabled, users are shown a &ldquo;Pay What You Can&rdquo; step after checking in.
            </p>
          </div>
          <button
            onClick={togglePayments}
            disabled={saving}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
              paymentsEnabled ? "bg-green-500" : "bg-[var(--color-border)]"
            } ${saving ? "opacity-50" : ""}`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                paymentsEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        {message && (
          <p className={`mt-3 text-sm ${message.type === "success" ? "text-green-500" : "text-red-500"}`}>
            {message.text}
          </p>
        )}
      </div>

      {/* Admin password */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h3 className="text-lg font-semibold">Admin Password</h3>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {hasDbPassword
            ? "Using a custom password (set via this panel)."
            : "Using the default password from the ADMIN_PASSWORD environment variable."}
        </p>

        <form onSubmit={handlePasswordChange} className="mt-4 space-y-3">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
          />
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={passwordSaving || !newPassword}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
            >
              {passwordSaving ? "Saving..." : "Update Password"}
            </button>
            {hasDbPassword && (
              <button
                type="button"
                onClick={resetToEnvPassword}
                disabled={passwordSaving}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] transition hover:bg-[var(--color-background)] disabled:opacity-50"
              >
                Reset to Default
              </button>
            )}
          </div>
        </form>
        {passwordMessage && (
          <p className={`mt-3 text-sm ${passwordMessage.type === "success" ? "text-green-500" : "text-red-500"}`}>
            {passwordMessage.text}
          </p>
        )}
      </div>

      {/* Changelog link */}
      {onShowChangelog && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Changelog</h3>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                View recent changes and updates to the app.
              </p>
            </div>
            <button
              onClick={onShowChangelog}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-muted)] transition hover:bg-[var(--color-background)] hover:text-[var(--color-foreground)]"
            >
              View changelog
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
