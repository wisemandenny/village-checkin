"use client";

import type { ReactNode } from "react";
import { useAnimationEnabled } from "./animation-context";

interface CollapseProps {
  show: boolean;
  children: ReactNode;
}

// Smoothly expands/collapses conditionally shown sections using the CSS grid
// `0fr`/`1fr` trick (no JS height measuring). When animations are off it falls
// back to plain conditional rendering, matching the original behavior.
export function Collapse({ show, children }: CollapseProps) {
  const enabled = useAnimationEnabled();

  if (!enabled) {
    return show ? <>{children}</> : null;
  }

  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-out"
      style={{ gridTemplateRows: show ? "1fr" : "0fr" }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
