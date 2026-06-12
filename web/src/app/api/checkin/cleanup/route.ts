import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Removes the rows created this session when a villager backs out of the
// payment stage (browser Back). Always keyed on the caller's own device_id
// (a random-UUID bearer token, like the other anon routes). Runs with the
// service role because RLS blocks anon deletes.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, check_in_id, delete_villager } = body;

  if (!device_id) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: villager } = await supabase
    .from("villagers")
    .select("id")
    .eq("device_id", device_id)
    .single();

  if (!villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  // Brand-new registrations get fully removed. Guard against deleting an
  // established account by refusing when the villager has any subscriptions —
  // a freshly registered villager never does.
  if (delete_villager) {
    const { data: subscriptions } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("villager_id", villager.id)
      .limit(1);

    if (!subscriptions || subscriptions.length === 0) {
      // Cascade clears this session's check-in along with the villager.
      const { error } = await supabase
        .from("villagers")
        .delete()
        .eq("id", villager.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ success: true });
    }
  }

  // Recover/returning users (or guarded villagers): drop only this session's
  // check-in, and only if it actually belongs to this villager.
  if (check_in_id) {
    const { error } = await supabase
      .from("check_ins")
      .delete()
      .eq("id", check_in_id)
      .eq("villager_id", villager.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true });
}
