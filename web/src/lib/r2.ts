import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Server-only helper for villager selfies, stored in a PRIVATE Cloudflare R2
// bucket. R2 is S3-compatible, so we reuse the AWS S3 SDK pointed at the R2
// endpoint with R2 credentials. Everything comes from the environment so staging
// and production point at different buckets.
//
// The bucket is never public: images are read back through the app's own
// /api/selfie route (see uploadSelfie's return + getSelfieObject), so no custom
// domain or r2.dev public URL is required.
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const SELFIE_BUCKET = process.env.R2_SELFIE_BUCKET;
const UPLOADS_BUCKET = process.env.R2_UPLOADS_BUCKET;
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
const SELFIE_PREFIX = "selfies";
const UPLOAD_PREFIX = "uploads";

export function isSelfieUploadConfigured(): boolean {
  return Boolean(SELFIE_BUCKET && getClient());
}

export function isUploadConfigured(): boolean {
  return Boolean(UPLOADS_BUCKET && getClient() && process.env.UPLOAD_TOKEN_SECRET);
}

export const ALLOWED_UPLOAD_TYPES = {
  "image/jpeg": { ext: "jpg", kind: "photo" as const },
  "image/png": { ext: "png", kind: "photo" as const },
  "image/webp": { ext: "webp", kind: "photo" as const },
  "video/mp4": { ext: "mp4", kind: "video" as const },
  "video/quicktime": { ext: "mov", kind: "video" as const },
} as const;

export type AllowedUploadType = keyof typeof ALLOWED_UPLOAD_TYPES;

export const UPLOAD_SIZE_CAPS = {
  photo: 15 * 1024 * 1024,
  video: 100 * 1024 * 1024,
} as const;

export function getUploadKind(contentType: string): "photo" | "video" | null {
  const entry = ALLOWED_UPLOAD_TYPES[contentType as AllowedUploadType];
  return entry?.kind ?? null;
}

export function getUploadSizeCap(kind: "photo" | "video"): number {
  return UPLOAD_SIZE_CAPS[kind];
}

export function isValidObjectKey(key: string): boolean {
  return /^uploads\/[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov)$/.test(key);
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
  if (!s3 || !SELFIE_BUCKET) return null;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const [, format, base64] = match;
  const body = Buffer.from(base64, "base64");
  const file = `${key}.${EXT[format]}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: SELFIE_BUCKET,
      Key: `${SELFIE_PREFIX}/${file}`,
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
  if (!s3 || !SELFIE_BUCKET) return null;
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: SELFIE_BUCKET, Key: `${SELFIE_PREFIX}/${file}` })
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

export async function presignUploadUrl({
  contentType,
  sizeBytes,
}: {
  contentType: AllowedUploadType;
  sizeBytes: number;
}): Promise<{ uploadUrl: string; objectKey: string } | null> {
  const s3 = getClient();
  if (!s3 || !UPLOADS_BUCKET) return null;

  const meta = ALLOWED_UPLOAD_TYPES[contentType];
  const kind = meta.kind;
  const cap = getUploadSizeCap(kind);
  if (sizeBytes <= 0 || sizeBytes > cap) return null;

  const objectKey = `${UPLOAD_PREFIX}/${crypto.randomUUID()}.${meta.ext}`;
  const command = new PutObjectCommand({
    Bucket: UPLOADS_BUCKET,
    Key: objectKey,
    ContentType: contentType,
    ContentLength: sizeBytes,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 120 });
  return { uploadUrl, objectKey };
}

function matchesMagicBytes(buf: Uint8Array, contentType: AllowedUploadType): boolean {
  if (contentType === "image/jpeg") {
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      buf.length >= 4 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    );
  }
  if (contentType === "image/webp") {
    return (
      buf.length >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    );
  }
  if (contentType === "video/mp4" || contentType === "video/quicktime") {
    if (buf.length < 8) return false;
    const ftyp = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
    return ftyp === "ftyp";
  }
  return false;
}

// HEAD + ranged GET magic-byte check. Returns verified size or null.
export async function verifyUploadedObject(
  objectKey: string,
  expectedType: AllowedUploadType
): Promise<number | null> {
  const s3 = getClient();
  if (!s3 || !UPLOADS_BUCKET || !isValidObjectKey(objectKey)) return null;

  const kind = ALLOWED_UPLOAD_TYPES[expectedType].kind;
  const cap = getUploadSizeCap(kind);

  let head;
  try {
    head = await s3.send(
      new HeadObjectCommand({ Bucket: UPLOADS_BUCKET, Key: objectKey })
    );
  } catch {
    return null;
  }

  const contentType = head.ContentType?.split(";")[0]?.trim();
  if (contentType !== expectedType) return null;

  const size = head.ContentLength;
  if (size == null || size <= 0 || size > cap) return null;

  let magicRes;
  try {
    magicRes = await s3.send(
      new GetObjectCommand({
        Bucket: UPLOADS_BUCKET,
        Key: objectKey,
        Range: "bytes=0-31",
      })
    );
  } catch {
    return null;
  }

  if (!magicRes.Body) return null;
  const bytes = await (magicRes.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  if (!matchesMagicBytes(bytes, expectedType)) return null;

  return size;
}

export async function presignDownloadUrl(
  objectKey: string,
  contentType: string
): Promise<string | null> {
  const s3 = getClient();
  if (!s3 || !UPLOADS_BUCKET || !isValidObjectKey(objectKey)) return null;

  const command = new GetObjectCommand({
    Bucket: UPLOADS_BUCKET,
    Key: objectKey,
    ResponseContentType: contentType,
    ResponseContentDisposition: "inline",
  });

  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

export async function deleteUploadObject(objectKey: string): Promise<boolean> {
  const s3 = getClient();
  if (!s3 || !UPLOADS_BUCKET || !isValidObjectKey(objectKey)) return false;
  try {
    await s3.send(
      new DeleteObjectCommand({ Bucket: UPLOADS_BUCKET, Key: objectKey })
    );
    return true;
  } catch {
    return false;
  }
}
