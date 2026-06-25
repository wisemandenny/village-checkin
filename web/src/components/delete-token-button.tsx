"use client";

import { useState } from "react";
import { clearDeviceId } from "@/lib/device-id";

// Staging-only dev helper for resetting the per-device identity. The parent
// layout decides whether to render this (it only mounts on APP_ENV=staging),
// so this component just renders the button.
export function DeleteTokenButton() {
  const [message, setMessage] = useState<string | null>(null);

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
        className="rounded-lg border border-red-500 bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-red-500 shadow-sm"
      >
        Delete stored token
      </button>
      {message && <p className="text-xs text-[var(--color-muted)]">{message}</p>}
    </div>
  );
}
