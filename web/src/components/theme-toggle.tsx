"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "@/lib/theme-context";

// Positioning is intentionally omitted: `relative` (inline) and `fixed` (chrome)
 // both establish a containing block for the absolute sun/moon icons. Putting
 // `relative` in the shared base made `fixed` lose to CSS source order, so the
 // admin login toggle sat in the centered flex layout instead of top-left.
const BASE_CLASS =
  "flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] shadow-sm transition-colors duration-200 hover:bg-[var(--color-border)]";

/**
 * The toggle itself. `className` controls placement so it can render both as a
 * fixed floating control (default site chrome) and inline within a page header
 * (e.g. the admin panel, where a fixed toggle would overlap the title).
 */
export function ThemeToggleButton({ className = "relative" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`${BASE_CLASS} ${className}`}
    >
      {/* Sun — visible in light mode */}
      <span
        aria-hidden
        className="absolute transition-all duration-300"
        style={{
          opacity: isDark ? 0 : 1,
          transform: isDark ? "rotate(90deg) scale(0.5)" : "rotate(0deg) scale(1)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="4.22" y1="4.22" x2="6.34" y2="6.34" />
          <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
          <line x1="2" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
          <line x1="4.22" y1="19.78" x2="6.34" y2="17.66" />
          <line x1="17.66" y1="6.34" x2="19.78" y2="4.22" />
        </svg>
      </span>

      {/* Moon — visible in dark mode */}
      <span
        aria-hidden
        className="absolute transition-all duration-300"
        style={{
          opacity: isDark ? 1 : 0,
          transform: isDark ? "rotate(0deg) scale(1)" : "rotate(-90deg) scale(0.5)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </span>
    </button>
  );
}

export function ThemeToggle() {
  const pathname = usePathname();
  // Admin routes render their own toggle inside the page chrome (see admin/page.tsx)
  // so it never overlaps the "Admin Panel" heading; skip the global fixed one there.
  if (pathname?.startsWith("/admin")) return null;

  return <ThemeToggleButton className="fixed left-4 top-4 z-50" />;
}
