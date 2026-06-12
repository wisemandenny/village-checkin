import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Returns the villager's check-in for today (most recent), so the phone can
// reflect the real payment status — e.g. after an admin records a cash payment.
export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("device_id");

  if (!deviceId) {
    return NextResponse.json(
      { error: "device_id is required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const { data: villager } = await supabase
    .from("villagers")
    .select("id")
    .eq("device_id", deviceId)
    .single();

  if (!villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).toISOString();
  const tomorrowStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  ).toISOString();

  const { data: checkIn } = await supabase
    .from("check_ins")
    .select("id, status, payment_method, intent_amount, created_at")
    .eq("villager_id", villager.id)
    .gte("created_at", todayStart)
    .lt("created_at", tomorrowStart)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ check_in: checkIn ?? null });
}
