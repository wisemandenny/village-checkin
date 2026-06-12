"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { useAnimationEnabled } from "./animation-context";

interface RevealProps {
  /** Stagger offset in milliseconds before this element animates in. */
  delay?: number;
  className?: string;
  children: ReactNode;
}

// Fades + slides its children in on mount. Renders statically when animations
// are disabled (admin flag off) or when the user prefers reduced motion (the
// CSS guards that case).
export function Reveal({ delay = 0, className, children }: RevealProps) {
  const enabled = useAnimationEnabled();

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      className={className ? `anim-reveal ${className}` : "anim-reveal"}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

interface StaggerProps {
  /** Delay added per child, in milliseconds. */
  step?: number;
  /** Delay before the first child, in milliseconds. */
  initialDelay?: number;
  children: ReactNode;
}

// Auto-increments the `delay` of its direct <Reveal> children so they cascade
// in. Non-Reveal children pass through untouched. Renders no wrapper element so
// the parent's layout (flex gap, grid, etc.) is preserved.
export function Stagger({ step = 60, initialDelay = 0, children }: StaggerProps) {
  const items = Children.toArray(children);
  const isReveal = (node: ReactNode): node is ReactElement<RevealProps> =>
    isValidElement(node) && node.type === Reveal;

  return (
    <>
      {items.map((child, i) => {
        if (!isReveal(child)) return child;
        // Delay is derived from how many Reveal children precede this one, so
        // nothing is mutated after render (keeps the React Compiler happy).
        const order = items.slice(0, i).filter(isReveal).length;
        return cloneElement(child, { delay: initialDelay + order * step });
      })}
    </>
  );
}
