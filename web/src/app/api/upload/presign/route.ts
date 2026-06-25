import { createServerClient } from "@/lib/supabase/server";
import {
  ALLOWED_UPLOAD_TYPES,
  getUploadKind,
  getUploadSizeCap,
  isUploadConfigured,
  presignUploadUrl,
  type AllowedUploadType,
} from "@/lib/r2";
import { mintUploadToken } from "@/lib/upload-token";
import {
  DAILY_BYTE_BUDGET,
  DAILY_UPLOAD_LIMIT,
  getDailyUploadUsage,
  hasCheckInToday,
} from "@/lib/upload-helpers";
import { checkRateLimit, clientIp } from "@/lib/upload-rate-limit";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  if (!isUploadConfigured()) {
    return NextResponse.json(
      { error: "Uploads are not available" },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const device_id = body?.device_id;
  const content_type = body?.content_type;
  const size_bytes = body?.size_bytes;

  if (!device_id || typeof device_id !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    typeof content_type !== "string" ||
    !(content_type in ALLOWED_UPLOAD_TYPES)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    typeof size_bytes !== "number" ||
    !Number.isInteger(size_bytes) ||
    size_bytes <= 0
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const typedContentType = content_type as AllowedUploadType;
  const kind = getUploadKind(typedContentType);
  if (!kind || size_bytes > getUploadSizeCap(kind)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const ip = clientIp(req);
  if (
    !checkRateLimit(`presign:device:${device_id}`, 10, 60_000) ||
    !checkRateLimit(`presign:ip:${ip}`, 30, 60_000)
  ) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = createServerClient();

  const { data: villager, error: lookupError } = await supabase
    .from("villagers")
    .select("id")
    .eq("device_id", device_id)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!villager) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await hasCheckInToday(supabase, villager.id))) {
    return NextResponse.json(
      { error: "Check in today before uploading" },
      { status: 403 }
    );
  }

  const usage = await getDailyUploadUsage(supabase, villager.id);
  if (usage.count >= DAILY_UPLOAD_LIMIT) {
    return NextResponse.json({ error: "Daily upload limit reached" }, { status: 429 });
  }
  if (usage.bytes + size_bytes > DAILY_BYTE_BUDGET) {
    return NextResponse.json({ error: "Daily upload limit reached" }, { status: 429 });
  }

  const presigned = await presignUploadUrl({
    contentType: typedContentType,
    sizeBytes: size_bytes,
  });
  if (!presigned) {
    return NextResponse.json({ error: "Uploads are not available" }, { status: 503 });
  }

  const tokenData = mintUploadToken(villager.id, presigned.objectKey);
  if (!tokenData) {
    return NextResponse.json({ error: "Uploads are not available" }, { status: 503 });
  }

  return NextResponse.json({
    upload_url: presigned.uploadUrl,
    object_key: presigned.objectKey,
    upload_token: tokenData.token,
  });
}
