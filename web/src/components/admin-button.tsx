"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminButton() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;

  return (
    <Link
      href="/admin"
      className="fixed right-4 top-4 z-50 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] shadow-sm"
    >
      Admin
    </Link>
  );
}
