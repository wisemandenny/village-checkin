import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

// Server-only helper for villager selfies, stored in a PRIVATE Cloudflare R2
// bucket. R2 is S3-compatible, so we reuse the AWS S3 SDK pointed at the R2
// endpoint with R2 credentials. Everything comes from the environment so staging
// and production point at different buckets.
//
// The bucket is never public: images are read back through the app's own
// /api/selfie route (see uploadSelfie's return + getSelfieObject), so no custom
// domain or r2.dev public URL is required.
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const BUCKET = process.env.R2_SELFIE_BUCKET;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

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

// The selfie filename (<id>.<ext>) lives under this prefix in the bucket. The
// stored selfie_url is the app path /api/selfie/<id>.<ext>; the read route maps
// it back to selfies/<id>.<ext>.
const PREFIX = "selfies";

export function isSelfieUploadConfigured(): boolean {
  return Boolean(BUCKET && getClient());
}

// Decode a base64 image data URL and upload it to R2 under selfies/<key>.<ext>.
// Returns the app-relative URL the board uses to load it, or null if R2 isn't
// configured or the input isn't a supported image data URL. Reusing the villager
// id as the key means a retake overwrites the previous selfie.
export async function uploadSelfie(
  dataUrl: string,
  key: string
): Promise<string | null> {
  const s3 = getClient();
  if (!s3 || !BUCKET) return null;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const [, format, base64] = match;
  const body = Buffer.from(base64, "base64");
  const file = `${key}.${EXT[format]}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${PREFIX}/${file}`,
      Body: body,
      ContentType: MIME[format],
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return `/api/selfie/${file}`;
}

// Fetch a selfie object for the /api/selfie read route. `file` is the
// "<id>.<ext>" segment from the URL; callers must validate it first.
export async function getSelfieObject(
  file: string
): Promise<{ body: ReadableStream; contentType: string } | null> {
  const s3 = getClient();
  if (!s3 || !BUCKET) return null;
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}/${file}` })
    );
    if (!res.Body) return null;
    return {
      body: (res.Body as { transformToWebStream: () => ReadableStream }).transformToWebStream(),
      contentType: res.ContentType ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}
