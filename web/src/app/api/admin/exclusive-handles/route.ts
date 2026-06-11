import { verifyAdmin } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase/server";
import {
  EXCLUSIVE_ROLE,
  getExclusiveHandles,
  parseHandlesText,
  setExclusiveHandles,
} from "@/lib/exclusive-tier";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const supabase = createServerClient();
  const handles = await getExclusiveHandles(supabase);
  return NextResponse.json({ handles });
}

// Replaces the exclusive-tier allowlist and grants the "exclusive" role to any
// already-registered villagers on the list. Not-yet-registered handles stay on
// the allowlist and are granted the role when they register/recover.
export async function PUT(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const text =
    typeof body.text === "string"
      ? body.text
      : Array.isArray(body.handles)
        ? body.handles.join("\n")
        : "";

  const handles = parseHandlesText(text);

  const supabase = createServerClient();
  await setExclusiveHandles(supabase, handles);

  let applied = 0;
  if (handles.length) {
    const { data: villagers } = await supabase
      .from("villagers")
      .select("id, roles")
      .in("ig_handle", handles);

    for (const villager of villagers ?? []) {
      const roles = villager.roles ?? [];
      if (roles.includes(EXCLUSIVE_ROLE)) continue;
      const { error } = await supabase
        .from("villagers")
        .update({ roles: [...roles, EXCLUSIVE_ROLE] })
        .eq("id", villager.id);
      if (!error) applied++;
    }
  }

  return NextResponse.json({ handles, applied });
}
