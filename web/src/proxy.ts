import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isMaintenanceMode } from "@/lib/maintenance";

// Paths that stay reachable even while the site is in maintenance mode:
// - /admin + /api/admin/* so an admin can log in and turn maintenance back off
// - /api/webhook/* so Stripe (and other) webhooks keep being processed
// - /maintenance so the lockdown landing page itself can render
const ALWAYS_ALLOWED = ["/admin", "/api/admin", "/api/webhook", "/maintenance"];

function isAlwaysAllowed(pathname: string): boolean {
  return ALWAYS_ALLOWED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAlwaysAllowed(pathname)) {
    return NextResponse.next();
  }

  if (!(await isMaintenanceMode())) {
    return NextResponse.next();
  }

  // Locked down: API callers get a clean 503, everything else is shown the
  // maintenance page (rewritten so the user keeps their original URL).
  if (pathname.startsWith("/api")) {
    return NextResponse.json(
      { error: "The site is temporarily down for maintenance." },
      { status: 503 }
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/maintenance";
  return NextResponse.rewrite(url);
}

export const config = {
  // Run on everything except Next.js internals and common static assets; the
  // proxy function itself decides what to block based on maintenance state.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
