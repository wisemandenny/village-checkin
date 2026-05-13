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
  const { data: attendee, error: lookupErr } = await supabase
    .from("attendees")
    .select("*")
    .ilike("display_name", display_name.trim())
    .single();

  if (lookupErr || !attendee) {
    return NextResponse.json(
      { error: "No account found with that name. Check your spelling or register as new." },
      { status: 404 }
    );
  }

  // Upsert the new device_id onto the existing attendee
  const { error: updateErr } = await supabase
    .from("attendees")
    .update({
      device_id: new_device_id,
      last_visited_at: new Date().toISOString(),
    })
    .eq("id", attendee.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    attendee: { ...attendee, device_id: new_device_id },
  });
}
