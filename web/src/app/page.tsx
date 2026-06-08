"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getOrCreateDeviceId } from "@/lib/device-id";
import { OnboardingForm } from "@/components/onboarding-form";
import { CheckInFlow } from "@/components/checkin-flow";

type Screen = "loading" | "onboarding" | "checkin";

export default function Home() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [deviceId, setDeviceId] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [isNewRegistration, setIsNewRegistration] = useState(false);

  useEffect(() => {
    const { deviceId: id, isNew } = getOrCreateDeviceId();
    setDeviceId(id);

    if (isNew) {
      setScreen("onboarding");
      return;
    }

    fetch(`/api/villager?device_id=${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.villager) {
          setDisplayName(data.villager.display_name);
          setScreen("checkin");
        } else {
          setScreen("onboarding");
        }
      })
      .catch(() => setScreen("onboarding"));
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <div className="mb-8 flex flex-col items-center gap-4">
        <Image
          src="/potluck-sessions.png"
          alt="Potluck Sessions — Takes a Village"
          width={260}
          height={100}
          priority
          className="h-auto w-56 sm:w-64"
        />
        <p className="text-lg tracking-wide text-[var(--color-muted)] font-[family-name:var(--font-domaine)]">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {screen === "loading" && (
        <img
          src="/potluck-chinese.png"
          alt="Loading…"
          className="h-36 w-auto animate-pulse-slow"
        />
      )}

      {screen === "onboarding" && (
        <OnboardingForm
          deviceId={deviceId}
          onComplete={(name, isNew) => {
            setDisplayName(name);
            setIsNewRegistration(isNew);
            setScreen("checkin");
          }}
        />
      )}

      {screen === "checkin" && (
        <CheckInFlow
          deviceId={deviceId}
          displayName={displayName}
          isNewRegistration={isNewRegistration}
        />
      )}
    </main>
  );
}
