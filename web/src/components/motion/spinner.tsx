"use client";

// Small inline loading spinner for buttons. Always spins (it is a functional
// loading indicator, not a decorative flourish), so it is not gated by the
// animations flag.
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className ?? ""}`}
    />
  );
}
