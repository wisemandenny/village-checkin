import { createServerClient } from "@/lib/supabase/server";
import { syncMarketingOptIn } from "@/lib/kit-sync";
import { EXCLUSIVE_ROLE, getExclusiveHandles, isHandleExclusive } from "@/lib/exclusive-tier";
import {
  EMAIL_TAKEN,
  IG_TAKEN,
  findDuplicateField,
  normalizeEmail,
  normalizeIgHandle,
  uniqueViolationMessage,
} from "@/lib/villager-dedupe";
import { uploadSelfie } from "@/lib/s3";
import { NextRequest, NextResponse } from "next/server";

// Cap the incoming selfie at ~1MB of data-URL text. Captures from the client are
// downscaled well under this; the bound just rejects oversized/abusive payloads
// before we decode and ship the bytes to S3.
const MAX_SELFIE_CHARS = 1_000_000;

function isValidSelfie(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(jpeg|png|webp);base64,/.test(value) &&
    value.length <= MAX_SELFIE_CHARS
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, display_name, email, ig_handle, roles, instruments, selfie } = body;
  // Default to opted-in when the flag is omitted (preserves prior behavior).
  const marketing_opt_in =
    body.marketing_opt_in === undefined ? true : Boolean(body.marketing_opt_in);

  if (!device_id || !display_name || !email) {
    return NextResponse.json(
      { error: "device_id, display_name, and email are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const normalizedEmail = normalizeEmail(email);
  const normalizedIg = ig_handle ? normalizeIgHandle(ig_handle) : "";

  // Reject duplicate email / IG handle up front for a clear, field-specific
  // message. The unique indexes remain the source of truth (see the 23505
  // handling below) and close the race window between this check and insert.
  const duplicate = await findDuplicateField(supabase, {
    email: normalizedEmail,
    igHandle: normalizedIg || null,
  });
  if (duplicate) {
    return NextResponse.json(
      { error: duplicate === "email" ? EMAIL_TAKEN : IG_TAKEN },
      { status: 409 }
    );
  }

  // Never trust a client-supplied exclusive role — it can only be granted via
  // the admin allowlist (it unlocks cheaper recurring pricing).
  const finalRoles: string[] = Array.isArray(roles)
    ? roles.filter((r: unknown) => typeof r === "string" && r.toLowerCase() !== EXCLUSIVE_ROLE)
    : [];

  if (normalizedIg) {
    const allowlist = await getExclusiveHandles(supabase);
    if (isHandleExclusive(normalizedIg, allowlist)) {
      finalRoles.push(EXCLUSIVE_ROLE);
    }
  }

  const record: Record<string, unknown> = {
    device_id,
    display_name,
    email: normalizedEmail,
    marketing_opt_in,
  };
  if (normalizedIg) record.ig_handle = normalizedIg;
  if (finalRoles.length) record.roles = finalRoles;
  if (instruments?.length) record.instruments = instruments;

  const { data, error } = await supabase
    .from("villagers")
    .insert(record)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: uniqueViolationMessage(error) },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Upload the registration selfie to S3 and store its URL. Best-effort: a bad
  // image or an S3 hiccup must never fail registration. Keyed by villager id so
  // a later retake overwrites it.
  if (isValidSelfie(selfie)) {
    try {
      const url = await uploadSelfie(selfie, data.id);
      if (url) {
        await supabase.from("villagers").update({ selfie_url: url }).eq("id", data.id);
        data.selfie_url = url;
      }
    } catch (err) {
      console.error("Selfie upload failed", err);
    }
  }

  // Mirror the opt-in choice into Kit. Non-blocking: a Kit failure must not
  // fail registration.
  const { kitSubscriberId } = await syncMarketingOptIn({
    email: normalizedEmail,
    firstName: display_name,
    optIn: marketing_opt_in,
    kitSubscriberId: null,
  });
  if (kitSubscriberId) {
    await supabase
      .from("villagers")
      .update({ kit_subscriber_id: kitSubscriberId })
      .eq("id", data.id);
  }

  return NextResponse.json({ villager: data }, { status: 201 });
}
