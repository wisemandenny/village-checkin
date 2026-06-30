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
    .contains("device_ids", [device_id])
    .single();

  if (!villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  // Brand-new registrations get fully removed. Two guards keep this from ever
  // touching an established account:
  //   1. Refuse if the villager has any subscriptions (lapsed/canceled rows
  //      persist as history, so this catches returning supporters).
  //   2. Refuse if the villager has any check-in other than this session's —
  //      a freshly registered villager has exactly one, so extra rows mean it
  //      is not a fresh account and a cascade delete would destroy real history.
  if (delete_villager) {
    const { data: subscriptions } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("villager_id", villager.id)
      .limit(1);

    let otherCheckInsQuery = supabase
      .from("check_ins")
      .select("id", { count: "exact", head: true })
      .eq("villager_id", villager.id);
    if (check_in_id) {
      otherCheckInsQuery = otherCheckInsQuery.neq("id", check_in_id);
    }
    const { count: otherCheckIns } = await otherCheckInsQuery;

    const hasNoSubscriptions = !subscriptions || subscriptions.length === 0;
    const hasNoOtherCheckIns = (otherCheckIns ?? 0) === 0;

    if (hasNoSubscriptions && hasNoOtherCheckIns) {
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
