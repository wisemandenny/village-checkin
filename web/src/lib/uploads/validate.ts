import type { UploadCategory, UploadKindConfig, UploadTypeSpec } from "./kinds";

// Magic-byte sniffing of a file's first bytes. This confirms the real container
// format regardless of the declared Content-Type, defeating type-spoofing such
// as an HTML or SVG payload mislabeled as image/jpeg. Only the first ~16 bytes
// are needed.
export function detectCategory(buf: Uint8Array): UploadCategory | null {
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image";
  }
  // WEBP: "RIFF" <4 bytes> "WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image";
  }
  // MP4 / QuickTime (MOV): bytes 4-7 spell "ftyp".
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    return "video";
  }
  return null;
}

export function typeSpecFor(
  kind: UploadKindConfig,
  mime: string
): UploadTypeSpec | null {
  return kind.allowed[mime] ?? null;
}

export function isAllowedType(kind: UploadKindConfig, mime: string): boolean {
  return Boolean(kind.allowed[mime]);
}

export function isWithinSize(kind: UploadKindConfig, bytes: number): boolean {
  return bytes > 0 && bytes <= kind.maxBytes;
}

const DATA_URL_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i;

// Decode a base64 data URL into its MIME type and raw bytes for the relay
// upload path. Returns null for anything that isn't a base64 data URL; the
// MIME type is validated against the kind allowlist later by putBytes.
export function parseDataUrl(
  dataUrl: unknown
): { mime: string; buffer: Buffer } | null {
  if (typeof dataUrl !== "string") return null;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], "base64") };
}
