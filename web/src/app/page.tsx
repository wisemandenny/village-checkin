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
  const [pendingCheckInId, setPendingCheckInId] = useState<string | undefined>();

  useEffect(() => {
    const { deviceId: id, isNew } = getOrCreateDeviceId();
    setDeviceId(id);

    if (isNew) {
      setScreen("onboarding");
      return;
    }

    // Returning user -- check if they exist, then check for pending check-in
    Promise.all([
      fetch(`/api/villager?device_id=${encodeURIComponent(id)}`).then((res) =>
        res.ok ? res.json() : null
      ),
      fetch(
        `/api/checkin/pending?device_id=${encodeURIComponent(id)}`
      ).then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([villagerData, pendingData]) => {
        if (villagerData?.villager) {
          setDisplayName(villagerData.villager.display_name);
          if (pendingData?.check_in) {
            setPendingCheckInId(pendingData.check_in.id);
          }
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
        <CheckInFlow
          deviceId={deviceId}
          displayName={displayName}
          pendingCheckInId={pendingCheckInId}
        />
      )}
    </main>
  );
}
