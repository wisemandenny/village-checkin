// Registry of "upload kinds" for the shared secure upload service. Every upload
// on takesavillage.com flows through this service and is described by exactly
// one kind here, so storage, allowed types, size caps, transfer mode, and
// serving rules live in a single place. Adding a new upload feature means
// adding a new entry below — no new R2/validation code.

export type UploadCategory = "image" | "video";

export interface UploadTypeSpec {
  // Filename extension stored in R2 for this MIME type.
  ext: string;
  category: UploadCategory;
}

export type UploadTransfer = "relay" | "presigned";
export type UploadReadVia = "proxy" | "presigned";

export interface UploadKindConfig {
  id: string;
  // R2 bucket name, resolved from env. Undefined disables the kind gracefully.
  bucket: string | undefined;
  // Key prefix within the bucket (e.g. "selfies", "uploads").
  prefix: string;
  // "relay": client posts bytes, server validates + writes (small images).
  // "presigned": client uploads directly to R2 via a presigned PUT (large media).
  transfer: UploadTransfer;
  // "proxy": served back through an app route that streams from R2.
  // "presigned": served via short-lived presigned GET URLs.
  readVia: UploadReadVia;
  // App URL base for proxy reads, e.g. "/api/selfie". Only used when
  // readVia === "proxy".
  readBasePath?: string;
  // MIME allowlist. Anything not present here (notably image/svg+xml and
  // text/html) is rejected.
  allowed: Record<string, UploadTypeSpec>;
  // Hard server-side size cap in bytes.
  maxBytes: number;
  // Content-Disposition used when serving the object back.
  disposition: "inline" | "attachment";
}

const IMAGE_TYPES: Record<string, UploadTypeSpec> = {
  "image/jpeg": { ext: "jpg", category: "image" },
  "image/png": { ext: "png", category: "image" },
  "image/webp": { ext: "webp", category: "image" },
};

// Resolve buckets lazily per call so env changes are picked up and so importing
// this module never throws when storage is unconfigured.
export const UPLOAD_KINDS: Record<string, UploadKindConfig> = {
  selfie: {
    id: "selfie",
    get bucket() {
      return process.env.R2_SELFIE_BUCKET;
    },
    prefix: "selfies",
    transfer: "relay",
    readVia: "proxy",
    readBasePath: "/api/selfie",
    allowed: IMAGE_TYPES,
    // Generous server cap; the client downscales selfies well below this and
    // the routes also bound the raw data-URL length.
    maxBytes: 3 * 1024 * 1024,
    disposition: "inline",
  },
};

export function getUploadKind(kindId: string): UploadKindConfig {
  const kind = UPLOAD_KINDS[kindId];
  if (!kind) throw new Error(`Unknown upload kind: ${kindId}`);
  return kind;
}
