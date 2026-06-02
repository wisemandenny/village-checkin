import { buildAuthorizeUrl, isKitOAuthConfigured } from "@/lib/kit-oauth";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

// One-time OAuth kickoff. Gated by KIT_OAUTH_SETUP_SECRET so the route is inert
// in normal operation. Visit /api/kit/oauth/start?secret=... in a browser while
// logged into the Kit account that should authorize the integration.
export async function GET(req: NextRequest) {
  const setupSecret = process.env.KIT_OAUTH_SETUP_SECRET;
  if (!setupSecret) {
    return NextResponse.json(
      { error: "KIT_OAUTH_SETUP_SECRET is not configured" },
      { status: 404 }
    );
  }
  if (req.nextUrl.searchParams.get("secret") !== setupSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isKitOAuthConfigured()) {
    return NextResponse.json(
      { error: "KIT_OAUTH_CLIENT_ID / KIT_OAUTH_CLIENT_SECRET are not set" },
      { status: 400 }
    );
  }

  const state = randomUUID();
  const redirectUri = `${req.nextUrl.origin}/api/kit/oauth/callback`;
  const authorizeUrl = buildAuthorizeUrl(redirectUri, state);

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set("kit_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/kit/oauth",
    maxAge: 600,
  });
  return res;
}
