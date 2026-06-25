"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { getOrCreateDeviceId } from "@/lib/device-id";
import { OnboardingForm } from "@/components/onboarding-form";
import { CheckInFlow } from "@/components/checkin-flow";
import { CheckinsDisabled } from "@/components/checkins-disabled";
import { AnimationProvider, Reveal } from "@/components/motion";

type Screen = "loading" | "onboarding" | "checkin" | "disabled";
type CheckInStep = "checking-in" | "payment" | "done";

export default function Home() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [deviceId, setDeviceId] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [isNewRegistration, setIsNewRegistration] = useState(false);
  const [checkinsEnabled, setCheckinsEnabled] = useState(true);

  // Latest values read inside the popstate handler. Refs avoid stale closures
  // and re-binding the listener on every state change.
  const screenRef = useRef<Screen>(screen);
  const deviceIdRef = useRef<string>(deviceId);
  const isNewRegistrationRef = useRef<boolean>(isNewRegistration);
  const checkInIdRef = useRef<string | null>(null);
  const checkInStepRef = useRef<CheckInStep | null>(null);
  const checkInPaidRef = useRef<boolean>(false);
  const checkInAlreadyRef = useRef<boolean>(false);
  const cleanedUpRef = useRef(false);

  screenRef.current = screen;
  deviceIdRef.current = deviceId;
  isNewRegistrationRef.current = isNewRegistration;

  const handleCheckInState = useCallback(
    ({
      checkInId,
      step,
      paid,
      alreadyCheckedIn,
    }: {
      checkInId: string | null;
      step: CheckInStep;
      paid: boolean;
      alreadyCheckedIn: boolean;
    }) => {
      checkInIdRef.current = checkInId;
      checkInStepRef.current = step;
      checkInPaidRef.current = paid;
      checkInAlreadyRef.current = alreadyCheckedIn;
    },
    []
  );

  useEffect(() => {
    const { deviceId: id, isNew } = getOrCreateDeviceId();
    setDeviceId(id);

    (async () => {
      // Resolve check-ins flag up front — decides whether a returning villager
      // checks in or sees the closed landing.
      let checkinsOn = true;
      try {
        const res = await fetch("/api/settings");
        const data = res.ok ? await res.json() : null;
        checkinsOn = data?.checkins_enabled !== false;
        setCheckinsEnabled(checkinsOn);
      } catch {
        // Default: check-ins on.
      }

      if (isNew) {
        setScreen("onboarding");
        return;
      }

      try {
        const res = await fetch(`/api/villager?device_id=${encodeURIComponent(id)}`);
        const data = res.ok ? await res.json() : null;
        if (data?.villager) {
          setDisplayName(data.villager.display_name);
          setScreen(checkinsOn ? "checkin" : "disabled");
        } else {
          setScreen("onboarding");
        }
      } catch {
        setScreen("onboarding");
      }
    })();
  }, []);

  // Wire the browser Back button to the in-React navigation. A single history
  // entry is pushed when onboarding hands off to the check-in flow (see
  // onComplete below), so Back from the payment stage returns to registration.
  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      const vcStage = (event.state as { vcStage?: string } | null)?.vcStage;

      // Forward navigation back into a checkin whose rows we already deleted —
      // bounce the user to the (cleaned) onboarding screen instead.
      if (vcStage === "checkin" && screenRef.current === "onboarding" && cleanedUpRef.current) {
        window.history.back();
        return;
      }

      // Back to the onboarding entry from the check-in flow.
      if (vcStage !== "checkin" && screenRef.current === "checkin") {
        const paid = checkInPaidRef.current;
        const alreadyCheckedIn = checkInAlreadyRef.current;
        // Clean up the rows created this session unless a real payment
        // completed (preserve it) or the check-in already existed today (a
        // prior session's row — never delete that, even when we now route it
        // to the payment screen). This covers visits that auto-bypass payment
        // to "done" (active subscription, payments disabled, or an explicit
        // skip), which would otherwise leave an orphaned villager and block
        // re-registration.
        if (!alreadyCheckedIn && !paid) {
          fetch("/api/checkin/cleanup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              device_id: deviceIdRef.current,
              check_in_id: checkInIdRef.current,
              delete_villager: isNewRegistrationRef.current,
            }),
          }).catch(() => {});
          cleanedUpRef.current = true;
        }
        checkInIdRef.current = null;
        checkInStepRef.current = null;
        checkInPaidRef.current = false;
        checkInAlreadyRef.current = false;
        setScreen("onboarding");
      }
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <AnimationProvider enabled={true}>
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

        {/* Keep the form mounted (just hidden) once past loading so its state —
            including the optional IG handle that grants the exclusive tier —
            survives the Back navigation from the check-in flow. Unmounting it
            would reset the IG field and drop an exclusive user to the standard
            tier on re-submit. */}
        {screen !== "loading" && (
          <div className={screen === "onboarding" ? "flex w-full justify-center" : "hidden"}>
            <OnboardingForm
              deviceId={deviceId}
              onComplete={(name, isNew) => {
                setDisplayName(name);
                setIsNewRegistration(isNew);
                // With check-ins closed, registration still succeeds but no
                // visit is recorded — drop the villager on the closed landing
                // instead of the check-in flow. The registration persists, so
                // there's no history-driven cleanup to wire up here.
                if (!checkinsEnabled) {
                  setScreen("disabled");
                  return;
                }
                cleanedUpRef.current = false;
                // Push a history entry so Back from the check-in flow returns
                // here to registration rather than leaving the site.
                window.history.pushState({ vcStage: "checkin" }, "");
                setScreen("checkin");
              }}
            />
          </div>
        )}

        {screen === "checkin" && (
          <Reveal className="flex w-full justify-center">
            <CheckInFlow
              deviceId={deviceId}
              displayName={displayName}
              isNewRegistration={isNewRegistration}
              onCheckInState={handleCheckInState}
            />
          </Reveal>
        )}

        {screen === "disabled" && (
          <Reveal className="flex w-full justify-center">
            <CheckinsDisabled
              deviceId={deviceId}
              displayName={displayName}
              isNewRegistration={isNewRegistration}
            />
          </Reveal>
        )}
      </main>
    </AnimationProvider>
  );
}
