import { createServerClient } from "@/lib/supabase/server";
import { uploadSelfie } from "@/lib/r2";
import { NextRequest, NextResponse } from "next/server";

// Cap the incoming selfie at ~1MB of data-URL text. Captures from the client are
// downscaled well under this; the bound just rejects oversized/abusive payloads
// before we decode and ship the bytes to R2. (Mirrors the register route.)
const MAX_SELFIE_CHARS = 1_000_000;

function isValidSelfie(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(jpeg|png|webp);base64,/.test(value) &&
    value.length <= MAX_SELFIE_CHARS
  );
}

// Sets (or replaces) a villager's selfie from the "who's here" page, for people
// who registered before selfies existed. Device-id based, like the other
// villager-facing routes. The upload mirrors the register flow: decode the
// data-URL selfie and store it in R2 keyed by the villager id.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { device_id, selfie } = body ?? {};

  if (!device_id) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }
  if (!isValidSelfie(selfie)) {
    return NextResponse.json({ error: "A valid selfie image is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: villager, error: lookupError } = await supabase
    .from("villagers")
    .select("id")
    .contains("device_ids", [device_id])
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 400 });
  }
  if (!villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  // Keyed by villager id so a later retake overwrites the previous selfie.
  const url = await uploadSelfie(selfie, villager.id);
  if (!url) {
    return NextResponse.json(
      { error: "Selfie storage is not available" },
      { status: 503 }
    );
  }

  const { error: updateError } = await supabase
    .from("villagers")
    .update({ selfie_url: url })
    .eq("id", villager.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ selfie_url: url });
}
