import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, intent_amount = 0, payment_method = "skipped" } = body;

  if (!device_id) {
    return NextResponse.json(
      { error: "device_id is required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  // Look up villager
  const { data: villager, error: lookupErr } = await supabase
    .from("villagers")
    .select("id, test_account")
    .eq("device_id", device_id)
    .single();

  if (lookupErr || !villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  // Check for existing check-in today (skip for test accounts)
  if (!villager.test_account) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const { data: existing } = await supabase
      .from("check_ins")
      .select("id")
      .eq("villager_id", villager.id)
      .gte("created_at", todayStart)
      .lt("created_at", tomorrowStart)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "already_checked_in" },
        { status: 409 }
      );
    }
  }

  await supabase
    .from("villagers")
    .update({ last_visited_at: new Date().toISOString() })
    .eq("id", villager.id);

  // Create check-in record
  const { data: checkIn, error: insertErr } = await supabase
    .from("check_ins")
    .insert({
      villager_id: villager.id,
      intent_amount,
      payment_method,
      status: payment_method === "skipped" ? "skipped" : "pending",
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ check_in: checkIn }, { status: 201 });
}
