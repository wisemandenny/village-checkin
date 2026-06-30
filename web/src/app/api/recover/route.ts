import { createServerClient } from "@/lib/supabase/server";
import { resolveExclusive } from "@/lib/exclusive-tier";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { ig_handle, new_device_id } = await req.json();

  if (!ig_handle || !new_device_id) {
    return NextResponse.json(
      { error: "ig_handle and new_device_id are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  let normalized = ig_handle.trim();
  if (!normalized.startsWith("@")) normalized = `@${normalized}`;

  const { data: villager, error: lookupErr } = await supabase
    .from("villagers")
    .select("*")
    .ilike("ig_handle", normalized)
    .single();

  if (lookupErr || !villager) {
    return NextResponse.json(
      { error: "No account found with that IG handle. Check your spelling or register as new." },
      { status: 404 }
    );
  }

  // Add the new device to the villager's existing devices (keep the old ones so
  // every device that has signed in continues to resolve to this account).
  const existingDevices: string[] = Array.isArray(villager.device_ids)
    ? villager.device_ids
    : [];
  const mergedDevices = Array.from(
    new Set([...existingDevices, new_device_id])
  );

  const { error: updateErr } = await supabase
    .from("villagers")
    .update({
      device_ids: mergedDevices,
      last_visited_at: new Date().toISOString(),
    })
    .eq("id", villager.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Permanent allowlist: re-apply the exclusive role on recovery in case the
  // handle was added after this villager first registered.
  await resolveExclusive(supabase, {
    id: villager.id,
    ig_handle: villager.ig_handle,
    roles: villager.roles,
  });

  return NextResponse.json({
    villager: { ...villager, device_ids: mergedDevices },
  });
}
