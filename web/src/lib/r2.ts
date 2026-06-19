import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Server-only helper for villager selfies, stored in Cloudflare R2. R2 is
// S3-compatible, so we reuse the AWS S3 SDK pointed at the R2 endpoint with R2
// credentials. Everything comes from the environment so staging and production
// point at different buckets.
//
// Uploads go through the S3 API endpoint, but reads are served from a separate
// public base URL (the bucket's r2.dev managed domain or a custom domain) — R2
// buckets aren't public at their API endpoint.
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const BUCKET = process.env.R2_SELFIE_BUCKET;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL;

let client: S3Client | null = null;
function getClient(): S3Client | null {
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) return null;
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
  }
  return client;
}

const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,(.+)$/;
const EXT: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp" };
const MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function isSelfieUploadConfigured(): boolean {
  return Boolean(BUCKET && PUBLIC_BASE_URL && getClient());
}

// Decode a base64 image data URL and upload it to R2 under selfies/<key>.<ext>.
// Returns the public URL, or null if R2 isn't configured or the input isn't a
// supported image data URL. Reusing the villager id as the key means a retake
// overwrites the previous selfie instead of orphaning it.
export async function uploadSelfie(
  dataUrl: string,
  key: string
): Promise<string | null> {
  const s3 = getClient();
  if (!s3 || !BUCKET || !PUBLIC_BASE_URL) return null;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const [, format, base64] = match;
  const body = Buffer.from(base64, "base64");
  const objectKey = `selfies/${key}.${EXT[format]}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: objectKey,
      Body: body,
      ContentType: MIME[format],
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return `${PUBLIC_BASE_URL.replace(/\/$/, "")}/${objectKey}`;
}
