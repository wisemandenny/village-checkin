"use client";

import { useState, useEffect, FormEvent } from "react";
import {
  CheckinSchedule,
  DEFAULT_CHECKIN_SCHEDULE,
} from "@/lib/checkin-schedule";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface SettingsPanelProps {
  token: string;
  onShowChangelog?: () => void;
}

export default function SettingsPanel({ token, onShowChangelog }: SettingsPanelProps) {
  const [checkinsEnabled, setCheckinsEnabled] = useState(true);
  const [checkinsSaving, setCheckinsSaving] = useState(false);
  const [checkinsMessage, setCheckinsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [schedule, setSchedule] = useState<CheckinSchedule>(DEFAULT_CHECKIN_SCHEDULE);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [hasDbPassword, setHasDbPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [kitSyncing, setKitSyncing] = useState(false);
  const [subRefreshing, setSubRefreshing] = useState(false);
  const [integrationMessage, setIntegrationMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [exclusiveHandles, setExclusiveHandles] = useState("");
  const [exclusiveSaving, setExclusiveSaving] = useState(false);
  const [exclusiveMessage, setExclusiveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
    loadExclusiveHandles();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setCheckinsEnabled(data.checkins_enabled !== false);
      setPaymentsEnabled(data.payments_enabled === true);
      setMaintenanceMode(data.maintenance_mode === true);
      setHasDbPassword(data.admin_password === "(set)");
      if (data.checkin_schedule) {
        setSchedule(data.checkin_schedule as CheckinSchedule);
      }
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

  async function toggleCheckins() {
    const newValue = !checkinsEnabled;
    setCheckinsSaving(true);
    setCheckinsMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: "checkins_enabled", value: newValue }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setCheckinsEnabled(newValue);
      setCheckinsMessage({
        type: "success",
        text: newValue
          ? "Check-ins open — visits are recorded again."
          : "Check-ins closed — visitors see the landing page (they can still register, subscribe, and pay off a past session).",
      });
    } catch {
      setCheckinsMessage({ type: "error", text: "Failed to update setting" });
    } finally {
      setCheckinsSaving(false);
    }
  }

  async function saveSchedule() {
    setScheduleSaving(true);
    setScheduleMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: "checkin_schedule", value: schedule }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setScheduleMessage({
        type: "success",
        text: schedule.enabled
          ? "Schedule saved — check-ins will follow it automatically (applied within ~15 minutes)."
          : "Schedule saved (disabled) — check-ins stay under manual control.",
      });
    } catch {
      setScheduleMessage({ type: "error", text: "Failed to save schedule" });
    } finally {
      setScheduleSaving(false);
    }
  }

  async function toggleMaintenance() {
    const newValue = !maintenanceMode;
    if (
      newValue &&
      !window.confirm(
        "Turn ON maintenance mode? This makes the entire site inaccessible to everyone except this admin panel."
      )
    ) {
      return;
    }
    setMaintenanceSaving(true);
    setMaintenanceMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: "maintenance_mode", value: newValue }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setMaintenanceMode(newValue);
      setMaintenanceMessage({
        type: "success",
        text: newValue
          ? "Maintenance mode ON — the site is locked down for everyone but admins."
          : "Maintenance mode OFF — the site is live again.",
      });
    } catch {
      setMaintenanceMessage({ type: "error", text: "Failed to update setting" });
    } finally {
      setMaintenanceSaving(false);
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

  async function loadExclusiveHandles() {
    try {
      const res = await fetch("/api/admin/exclusive-handles", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setExclusiveHandles((data.handles ?? []).join("\n"));
    } catch {
      // non-fatal; admin can still edit and save
    }
  }

  async function saveExclusiveHandles() {
    setExclusiveSaving(true);
    setExclusiveMessage(null);
    try {
      const res = await fetch("/api/admin/exclusive-handles", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: exclusiveHandles }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setExclusiveHandles((data.handles ?? []).join("\n"));
      setExclusiveMessage({
        type: "success",
        text: `Saved ${data.handles.length} handle${data.handles.length === 1 ? "" : "s"} — granted the exclusive role to ${data.applied} registered villager${data.applied === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      setExclusiveMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setExclusiveSaving(false);
    }
  }

  async function syncKit() {
    setKitSyncing(true);
    setIntegrationMessage(null);
    try {
      const res = await fetch("/api/admin/kit/sync-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setIntegrationMessage({
        type: "success",
        text: `Synced ${data.total} villagers — ${data.subscribed} subscribed, ${data.unsubscribed} unsubscribed, ${data.skipped} skipped${data.failed ? `, ${data.failed} failed` : ""}.`,
      });
    } catch (err) {
      setIntegrationMessage({ type: "error", text: err instanceof Error ? err.message : "Sync failed" });
    } finally {
      setKitSyncing(false);
    }
  }

  async function refreshSubscriptions() {
    setSubRefreshing(true);
    setIntegrationMessage(null);
    try {
      const res = await fetch("/api/admin/subscriptions/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      setIntegrationMessage({
        type: "success",
        text: `Reconciled ${data.synced} subscriptions from Stripe${data.failed ? ` (${data.failed} failed)` : ""}.`,
      });
    } catch (err) {
      setIntegrationMessage({ type: "error", text: err instanceof Error ? err.message : "Refresh failed" });
    } finally {
      setSubRefreshing(false);
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
      {/* Maintenance mode toggle */}
      <div
        className={`rounded-xl border bg-[var(--color-surface)] p-6 ${
          maintenanceMode ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Maintenance mode</h3>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              When ON, the entire site is inaccessible (check-in, payments, every page and API)
              except this admin panel. Visitors see a &ldquo;down for maintenance&rdquo; page. OFF by default.
            </p>
          </div>
          <button
            onClick={toggleMaintenance}
            disabled={maintenanceSaving}
            aria-pressed={maintenanceMode}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
              maintenanceMode ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
            } ${maintenanceSaving ? "opacity-50" : ""}`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                maintenanceMode ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        {maintenanceMode && (
          <p className="mt-3 text-sm font-medium text-[var(--color-accent)]">
            The site is currently locked down.
          </p>
        )}
        {maintenanceMessage && (
          <p className={`mt-3 text-sm ${maintenanceMessage.type === "success" ? "text-green-500" : "text-red-500"}`}>
            {maintenanceMessage.text}
          </p>
        )}
      </div>

      {/* Check-ins: manual toggle + automatic schedule */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h3 className="text-lg font-semibold">Check-ins</h3>
        <div className="mt-4 space-y-5">
          {/* Manual toggle */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Manual toggle</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                When ON, visiting the site records a check-in. Turn OFF on non-studio days so
                useless check-ins aren&rsquo;t captured — visitors then see a &ldquo;check-ins closed&rdquo;
                page where they can still register, subscribe, and pay off a past session.
              </p>
              {!checkinsEnabled && (
                <p className="mt-2 text-sm font-medium text-[var(--color-accent)]">
                  Check-ins are currently closed.
                </p>
              )}
              {checkinsMessage && (
                <p className={`mt-2 text-sm ${checkinsMessage.type === "success" ? "text-green-500" : "text-red-500"}`}>
                  {checkinsMessage.text}
                </p>
              )}
            </div>
            <button
              onClick={toggleCheckins}
              disabled={checkinsSaving}
              aria-pressed={checkinsEnabled}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
                checkinsEnabled ? "bg-green-500" : "bg-[var(--color-border)]"
              } ${checkinsSaving ? "opacity-50" : ""}`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  checkinsEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Automatic schedule */}
          <div className="border-t border-[var(--color-border)] pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Automatic schedule</p>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  When ON, a scheduled job opens and closes check-ins automatically each week.
                  The manual toggle above still works for ad-hoc changes; the schedule re-asserts
                  itself at the next open or close time.
                </p>
              </div>
              <button
                onClick={() => setSchedule({ ...schedule, enabled: !schedule.enabled })}
                aria-pressed={schedule.enabled}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
                  schedule.enabled ? "bg-green-500" : "bg-[var(--color-border)]"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    schedule.enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--color-border)] p-4">
                <p className="mb-3 text-sm font-medium">Opens</p>
                <div className="flex gap-3">
                  <select
                    value={schedule.open.day}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        open: { ...schedule.open, day: Number(e.target.value) },
                      })
                    }
                    className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
                  >
                    {DAY_NAMES.map((name, i) => (
                      <option key={name} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={schedule.open.time}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        open: { ...schedule.open, time: e.target.value },
                      })
                    }
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-[var(--color-border)] p-4">
                <p className="mb-3 text-sm font-medium">Closes</p>
                <div className="flex gap-3">
                  <select
                    value={schedule.close.day}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        close: { ...schedule.close, day: Number(e.target.value) },
                      })
                    }
                    className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
                  >
                    {DAY_NAMES.map((name, i) => (
                      <option key={name} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={schedule.close.time}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        close: { ...schedule.close, time: e.target.value },
                      })
                    }
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={saveSchedule}
                disabled={scheduleSaving}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
              >
                {scheduleSaving ? "Saving…" : "Save schedule"}
              </button>
              {scheduleMessage && (
                <p className={`text-sm ${scheduleMessage.type === "success" ? "text-green-500" : "text-red-500"}`}>
                  {scheduleMessage.text}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

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

      {/* Integrations: Kit + Stripe subscriptions */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h3 className="text-lg font-semibold">Integrations</h3>
        <div className="mt-4 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Kit mailing list</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Reconcile every villager with Kit based on their marketing opt-in. Safe to run repeatedly.
              </p>
            </div>
            <button
              onClick={syncKit}
              disabled={kitSyncing}
              className="shrink-0 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
            >
              {kitSyncing ? "Syncing…" : "Sync all villagers to Kit"}
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 border-t border-[var(--color-border)] pt-5">
            <div>
              <p className="text-sm font-medium">Recurring subscriptions</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Re-sync the local subscriptions table from Stripe in case a webhook was missed.
              </p>
            </div>
            <button
              onClick={refreshSubscriptions}
              disabled={subRefreshing}
              className="shrink-0 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-muted)] transition hover:bg-[var(--color-background)] hover:text-[var(--color-foreground)] disabled:opacity-50"
            >
              {subRefreshing ? "Refreshing…" : "Refresh from Stripe"}
            </button>
          </div>
        </div>
        {integrationMessage && (
          <p className={`mt-4 text-sm ${integrationMessage.type === "success" ? "text-green-500" : "text-red-500"}`}>
            {integrationMessage.text}
          </p>
        )}
      </div>

      {/* Exclusive tier */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h3 className="text-lg font-semibold">Exclusive tier</h3>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          One IG handle per line (e.g. <code>@champagnepapi</code>). Handles on this list unlock the
          $10/month recurring tier (plus the card processing fee). Registered villagers get the
          exclusive role on save; anyone not registered yet gets it automatically when they sign up.
        </p>
        <textarea
          value={exclusiveHandles}
          onChange={(e) => setExclusiveHandles(e.target.value)}
          rows={6}
          placeholder={"@handle_one\n@handle_two"}
          className="mt-4 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 font-mono text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={saveExclusiveHandles}
            disabled={exclusiveSaving}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-light)] disabled:opacity-50"
          >
            {exclusiveSaving ? "Saving…" : "Save exclusive tier"}
          </button>
          {exclusiveMessage && (
            <p className={`text-sm ${exclusiveMessage.type === "success" ? "text-green-500" : "text-red-500"}`}>
              {exclusiveMessage.text}
            </p>
          )}
        </div>
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
