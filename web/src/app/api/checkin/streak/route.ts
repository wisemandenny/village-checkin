import { createServerClient } from "@/lib/supabase/server";
import { computeStreaks } from "@/lib/checkin-streaks";
import { NextRequest, NextResponse } from "next/server";

// Returns the caller's weekly check-in streak (current + best), keyed by device.
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
    .contains("device_ids", [deviceId])
    .single();

  if (!villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  const { data: checkins, error } = await supabase
    .from("check_ins")
    .select("created_at")
    .eq("villager_id", villager.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load check-ins" },
      { status: 500 }
    );
  }

  const streaks = computeStreaks(checkins ?? []);

  return NextResponse.json({
    current: streaks.current,
    current_start: streaks.currentStart,
    best: streaks.best,
    best_start: streaks.bestStart,
    best_end: streaks.bestEnd,
    best_is_current: streaks.bestIsCurrent,
  });
}
