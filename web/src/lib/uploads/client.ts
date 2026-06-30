import { S3Client } from "@aws-sdk/client-s3";

// Single S3 client for all upload kinds. R2 is S3-compatible, so we point the
// AWS SDK at the R2 endpoint with R2 credentials. Credentials are shared across
// buckets; each kind selects its own bucket (see kinds.ts).
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

let client: S3Client | null = null;

export function getS3Client(): S3Client | null {
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) return null;
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}
