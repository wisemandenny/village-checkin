import { exchangeAuthorizationCode } from "@/lib/kit-oauth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function htmlResponse(message: string, status: number): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Kit OAuth</title></head><body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem"><h1>Kit OAuth</h1><p>${message}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// OAuth redirect target. Validates the state cookie set by /start, exchanges
// the authorization code for tokens, and persists them in studio_settings.
// Tokens are stored server-side -- nothing sensitive is shown in the browser.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const error = params.get("error");
  if (error) {
    return htmlResponse(`Authorization failed: ${error}`, 400);
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = req.cookies.get("kit_oauth_state")?.value;

  if (!code || !state) {
    return htmlResponse("Missing code or state.", 400);
  }
  if (!expectedState || state !== expectedState) {
    return htmlResponse(
      "State mismatch. Restart the flow at /api/kit/oauth/start?secret=...",
      403
    );
  }

  const redirectUri = `${req.nextUrl.origin}/api/kit/oauth/callback`;
  try {
    await exchangeAuthorizationCode(code, redirectUri);
  } catch (err) {
    console.error("[kit-oauth] callback exchange failed:", err);
    return htmlResponse(
      "Token exchange failed. Check the server logs and verify the redirect URI matches the one registered in Kit.",
      500
    );
  }

  const res = htmlResponse(
    "\u2705 Kit OAuth is connected. Purchase records will now sync. You can close this tab.",
    200
  );
  res.cookies.delete("kit_oauth_state");
  return res;
}
