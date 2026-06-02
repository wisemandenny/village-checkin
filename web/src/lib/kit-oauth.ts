// Kit OAuth token manager. Server-only.
//
// Kit's /v4/purchases (and bulk) endpoints require OAuth -- API keys are
// rejected. Access tokens expire and refresh tokens may rotate, so the
// durable design keeps only the client credentials in env and persists the
// refresh/access tokens in studio_settings (key "kit_oauth"). A short-lived
// in-memory cache avoids refreshing on every request within a warm instance.
//
// Docs: https://developers.kit.com/api-reference/oauth-refresh-token-flow

import { createServerClient } from "@/lib/supabase/server";

const KIT_OAUTH_TOKEN_URL = "https://api.kit.com/v4/oauth/token";
const KIT_OAUTH_AUTHORIZE_URL = "https://api.kit.com/v4/oauth/authorize";
const SETTINGS_KEY = "kit_oauth";
const REQUEST_TIMEOUT_MS = 15_000;
// Refresh a little before the real expiry to avoid edge-of-expiry failures.
const EXPIRY_SKEW_MS = 60_000;

interface StoredTokens {
  refresh_token: string;
  access_token: string;
  access_token_expires_at: string; // ISO timestamp
}

interface KitTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number; // seconds
}

let memoryCache: { accessToken: string; expiresAtMs: number } | null = null;

export function isKitOAuthConfigured(): boolean {
  return Boolean(
    process.env.KIT_OAUTH_CLIENT_ID && process.env.KIT_OAUTH_CLIENT_SECRET
  );
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.KIT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.KIT_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("KIT_OAUTH_CLIENT_ID / KIT_OAUTH_CLIENT_SECRET are not set");
  }
  return { clientId, clientSecret };
}

// Builds the Kit authorization URL for the one-time consent flow.
export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });
  return `${KIT_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

async function readStoredTokens(): Promise<StoredTokens | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("studio_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (error) {
    console.error("[kit-oauth] failed to read tokens:", error.message);
    return null;
  }
  return (data?.value as StoredTokens | undefined) ?? null;
}

async function writeStoredTokens(tokens: StoredTokens): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("studio_settings")
    .upsert({ key: SETTINGS_KEY, value: tokens }, { onConflict: "key" });
  if (error) {
    console.error("[kit-oauth] failed to persist tokens:", error.message);
    throw new Error("Failed to persist Kit OAuth tokens");
  }
}

function toStoredTokens(
  res: KitTokenResponse,
  previousRefreshToken?: string
): StoredTokens {
  const expiresInMs = (res.expires_in ?? 3600) * 1000;
  return {
    // Kit may rotate the refresh token; fall back to the previous one if the
    // response omits it.
    refresh_token: res.refresh_token ?? previousRefreshToken ?? "",
    access_token: res.access_token,
    access_token_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
  };
}

async function postToken(body: Record<string, string>): Promise<KitTokenResponse> {
  const res = await fetch(KIT_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kit OAuth token error: ${res.status} ${text}`);
  }
  return JSON.parse(text) as KitTokenResponse;
}

// Exchanges an authorization code (one-time consent) for tokens and persists
// them. Called by the OAuth callback route.
export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string
): Promise<void> {
  const { clientId, clientSecret } = getClientCredentials();
  const res = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  if (!res.refresh_token) {
    throw new Error("Kit OAuth token response did not include a refresh_token");
  }
  const stored = toStoredTokens(res);
  await writeStoredTokens(stored);
  memoryCache = {
    accessToken: stored.access_token,
    expiresAtMs: Date.parse(stored.access_token_expires_at),
  };
}

async function refreshAccessToken(stored: StoredTokens): Promise<string> {
  const { clientId, clientSecret } = getClientCredentials();
  const res = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: stored.refresh_token,
  });
  const next = toStoredTokens(res, stored.refresh_token);
  await writeStoredTokens(next);
  memoryCache = {
    accessToken: next.access_token,
    expiresAtMs: Date.parse(next.access_token_expires_at),
  };
  return next.access_token;
}

// Returns a valid Kit access token, refreshing if needed. Returns null when
// OAuth is not configured or no tokens have been authorized yet.
export async function getKitAccessToken(): Promise<string | null> {
  if (!isKitOAuthConfigured()) return null;

  if (memoryCache && memoryCache.expiresAtMs - EXPIRY_SKEW_MS > Date.now()) {
    return memoryCache.accessToken;
  }

  const stored = await readStoredTokens();
  if (!stored?.refresh_token) return null;

  if (Date.parse(stored.access_token_expires_at) - EXPIRY_SKEW_MS > Date.now()) {
    memoryCache = {
      accessToken: stored.access_token,
      expiresAtMs: Date.parse(stored.access_token_expires_at),
    };
    return stored.access_token;
  }

  return refreshAccessToken(stored);
}

// True once a one-time authorization has produced stored tokens.
export async function isKitOAuthAuthorized(): Promise<boolean> {
  if (!isKitOAuthConfigured()) return false;
  const stored = await readStoredTokens();
  return Boolean(stored?.refresh_token);
}
