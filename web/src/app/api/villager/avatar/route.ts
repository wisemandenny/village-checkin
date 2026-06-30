import { createServerClient } from "@/lib/supabase/server";
import { isPoolId } from "@/lib/pokemon";
import { NextRequest, NextResponse } from "next/server";

// Saves a villager's fused-Pokemon avatar. Device-id based (no admin auth),
// mirroring the other villager-facing routes.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { device_id, avatar_head, avatar_body } = body ?? {};

  if (!device_id) {
    return NextResponse.json(
      { error: "device_id is required" },
      { status: 400 }
    );
  }

  if (!isPoolId(avatar_head) || !isPoolId(avatar_body)) {
    return NextResponse.json(
      { error: "avatar_head and avatar_body must be valid pool Pokemon IDs" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("villagers")
    .update({ avatar_head, avatar_body })
    .contains("device_ids", [device_id])
    .select("id, display_name, avatar_head, avatar_body")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  return NextResponse.json({ villager: data });
}
