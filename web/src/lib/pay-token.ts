import { createHmac, timingSafeEqual } from "crypto";

// Signed, self-contained links that let a villager settle one specific unpaid
// check-in straight from a reminder email — no device recovery needed. Modeled
// on lib/upload-token.ts but the token embeds the check_in_id so a single URL
// path segment (/pay/<token>) is enough, and uses a long TTL because the 24h
// reminder must still resolve days after check-in.

// 7 days: comfortably covers the 1h + 24h reminder window plus slack.
const TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

function getSecret(): string | null {
  return process.env.PAY_TOKEN_SECRET ?? null;
}

export function isPayTokenConfigured(): boolean {
  return Boolean(getSecret());
}

// Returns `<checkInId>.<exp>.<sig>` or null when no secret is configured.
export function mintPayToken(checkInId: string): string | null {
  const secret = getSecret();
  if (!secret) return null;

  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const sig = sign(checkInId, exp, secret);
  return `${checkInId}.${exp}.${sig}`;
}

// Parses and verifies a token, returning the embedded check_in_id (or null when
// invalid/expired/unconfigured).
export function verifyPayToken(token: string): { checkInId: string } | null {
  const secret = getSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [checkInId, expStr, sig] = parts;

  const exp = Number(expStr);
  if (!checkInId || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  const expected = sign(checkInId, exp, secret);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  return { checkInId };
}

function sign(checkInId: string, exp: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${checkInId}|${exp}`)
    .digest("base64url");
}
