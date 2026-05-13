import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

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

  const cutoff = new Date(Date.now() - SIX_HOURS_MS).toISOString();

  const { data: checkIn } = await supabase
    .from("check_ins")
    .select("*")
    .eq("villager_id", villager.id)
    .eq("status", "pending")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!checkIn) {
    return NextResponse.json({ check_in: null });
  }

  return NextResponse.json({ check_in: checkIn });
}
