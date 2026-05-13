import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, display_name, primary_role } = body;

  if (!device_id || !display_name) {
    return NextResponse.json(
      { error: "device_id and display_name are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const record: Record<string, unknown> = { device_id, display_name };
  if (primary_role) record.primary_role = primary_role;

  const { data, error } = await supabase
    .from("attendees")
    .insert(record)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Device already registered" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attendee: data }, { status: 201 });
}
