"use client";

import { useEffect, useState } from "react";
import { getOrCreateDeviceId } from "@/lib/device-id";
import { OnboardingForm } from "@/components/onboarding-form";
import { CheckInFlow } from "@/components/checkin-flow";

type Screen = "loading" | "onboarding" | "checkin";

export default function Home() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [deviceId, setDeviceId] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");

  useEffect(() => {
    const { deviceId: id, isNew } = getOrCreateDeviceId();
    setDeviceId(id);

    if (isNew) {
      setScreen("onboarding");
      return;
    }

    // Returning user — check if they exist in the DB
    fetch(`/api/attendee?device_id=${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.attendee) {
          setDisplayName(data.attendee.display_name);
          setScreen("checkin");
        } else {
          setScreen("onboarding");
        }
      })
      .catch(() => setScreen("onboarding"));
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Village Studio</h1>
        <p className="mt-2 text-[var(--color-muted)]">Open recording session</p>
      </div>

      {screen === "loading" && (
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
      )}

      {screen === "onboarding" && (
        <OnboardingForm
          deviceId={deviceId}
          onComplete={(name) => {
            setDisplayName(name);
            setScreen("checkin");
          }}
        />
      )}

      {screen === "checkin" && (
        <CheckInFlow deviceId={deviceId} displayName={displayName} />
      )}
    </main>
  );
}
