import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("device_id");

  if (!deviceId) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("villagers")
    .select("*")
    .contains("device_ids", [deviceId])
    .single();

  if (error || !data) {
    return NextResponse.json({ villager: null }, { status: 404 });
  }

  return NextResponse.json({ villager: data });
}
