import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { display_name, new_device_id } = await req.json();

  if (!display_name || !new_device_id) {
    return NextResponse.json(
      { error: "display_name and new_device_id are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  // Case-insensitive lookup
  const { data: villager, error: lookupErr } = await supabase
    .from("villagers")
    .select("*")
    .ilike("display_name", display_name.trim())
    .single();

  if (lookupErr || !villager) {
    return NextResponse.json(
      { error: "No account found with that name. Check your spelling or register as new." },
      { status: 404 }
    );
  }

  // Upsert the new device_id onto the existing villager
  const { error: updateErr } = await supabase
    .from("villagers")
    .update({
      device_id: new_device_id,
      last_visited_at: new Date().toISOString(),
    })
    .eq("id", villager.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    villager: { ...villager, device_id: new_device_id },
  });
}
