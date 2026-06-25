"use client";

import { useEffect, useState } from "react";
import { clearDeviceId } from "@/lib/device-id";

export function DeleteTokenButton() {
  const [isStaging, setIsStaging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.app_env === "staging") setIsStaging(true);
      })
      .catch(() => {
        // non-fatal; button stays hidden
      });
  }, []);

  if (!isStaging) return null;

  function handleClick() {
    if (
      !window.confirm(
        "Delete your stored device token? You will be treated as a new device on the next page load."
      )
    ) {
      return;
    }
    clearDeviceId();
    setMessage("Token deleted — reloading…");
    window.location.reload();
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        className="rounded-lg border border-red-500/40 bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-red-500 shadow-sm transition hover:bg-red-500/10"
      >
        Delete stored token
      </button>
      {message && <p className="text-xs text-[var(--color-muted)]">{message}</p>}
    </div>
  );
}
