"use client";

import { createContext, useContext, type ReactNode } from "react";

// Gates every onboarding animation behind the `animations_enabled` admin
// setting. Defaults to `false` so nothing animates until the flag has loaded,
// which avoids a flash of motion on first paint.
const AnimationContext = createContext(false);

export function AnimationProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <AnimationContext.Provider value={enabled}>
      {children}
    </AnimationContext.Provider>
  );
}

export function useAnimationEnabled(): boolean {
  return useContext(AnimationContext);
}
