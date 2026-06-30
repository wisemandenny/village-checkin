import { createServerClient } from "@/lib/supabase/server";
import {
  ALLOWED_UPLOAD_TYPES,
  deleteUploadObject,
  isUploadConfigured,
  isValidObjectKey,
  verifyUploadedObject,
  type AllowedUploadType,
} from "@/lib/r2";
import { verifyUploadToken } from "@/lib/upload-token";
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
  const object_key = body?.object_key;
  const content_type = body?.content_type;
  const upload_token = body?.upload_token;

  if (!device_id || typeof device_id !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!object_key || typeof object_key !== "string" || !isValidObjectKey(object_key)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    typeof content_type !== "string" ||
    !(content_type in ALLOWED_UPLOAD_TYPES)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!upload_token || typeof upload_token !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const typedContentType = content_type as AllowedUploadType;

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

  if (!verifyUploadToken(villager.id, object_key, upload_token)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const verifiedSize = await verifyUploadedObject(object_key, typedContentType);
  if (verifiedSize == null) {
    await deleteUploadObject(object_key);
    return NextResponse.json({ error: "Upload verification failed" }, { status: 400 });
  }

  const kind = ALLOWED_UPLOAD_TYPES[typedContentType].kind;

  const { data, error } = await supabase
    .from("uploads")
    .insert({
      villager_id: villager.id,
      object_key,
      content_type: typedContentType,
      kind,
      size_bytes: verifiedSize,
    })
    .select("id, kind, created_at")
    .single();

  if (error) {
    await deleteUploadObject(object_key);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ upload: data }, { status: 201 });
}
