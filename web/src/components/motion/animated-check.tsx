"use client";

import { useAnimationEnabled } from "./animation-context";

// Success checkmark. When animations are on, the stroke draws itself in (see
// `.anim-check` in globals.css); otherwise it renders fully drawn.
export function AnimatedCheck({ className }: { className?: string }) {
  const enabled = useAnimationEnabled();
  return (
    <svg
      className={`${enabled ? "anim-check " : ""}${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
