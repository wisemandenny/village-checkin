import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_TTL_SEC = 300;

function getSecret(): string | null {
  return process.env.UPLOAD_TOKEN_SECRET ?? null;
}

export function isUploadTokenConfigured(): boolean {
  return Boolean(getSecret());
}

export function mintUploadToken(
  villagerId: string,
  objectKey: string
): { token: string; exp: number } | null {
  const secret = getSecret();
  if (!secret) return null;

  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const payload = `${villagerId}|${objectKey}|${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `${exp}.${sig}`, exp };
}

export function verifyUploadToken(
  villagerId: string,
  objectKey: string,
  token: string
): boolean {
  const secret = getSecret();
  if (!secret || !token.includes(".")) return false;

  const [expStr, sig] = token.split(".", 2);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  const payload = `${villagerId}|${objectKey}|${exp}`;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
