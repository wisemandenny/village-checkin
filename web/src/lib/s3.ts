import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Server-only S3 helper for villager selfies. Configuration comes entirely from
// the environment so staging and production can point at different buckets.
// Credentials are resolved by the AWS SDK's default provider chain
// (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY on Vercel).
const REGION = process.env.AWS_REGION ?? "us-east-1";
const BUCKET = process.env.AWS_S3_SELFIE_BUCKET;

let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) client = new S3Client({ region: REGION });
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
  return Boolean(BUCKET);
}

// Decode a base64 image data URL and upload it to S3 under selfies/<key>.<ext>.
// Returns the public object URL, or null if S3 isn't configured or the input
// isn't a supported image data URL. Reusing the villager id as the key means a
// retake overwrites the previous selfie instead of orphaning it.
export async function uploadSelfie(
  dataUrl: string,
  key: string
): Promise<string | null> {
  if (!BUCKET) return null;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const [, format, base64] = match;
  const body = Buffer.from(base64, "base64");
  const objectKey = `selfies/${key}.${EXT[format]}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: objectKey,
      Body: body,
      ContentType: MIME[format],
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${objectKey}`;
}
