import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, display_name, email, ig_handle, roles, instruments } = body;

  if (!device_id || !display_name || !email) {
    return NextResponse.json(
      { error: "device_id, display_name, and email are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const record: Record<string, unknown> = { device_id, display_name, email };
  if (ig_handle) record.ig_handle = ig_handle;
  if (roles?.length) record.roles = roles;
  if (instruments?.length) record.instruments = instruments;

  const { data, error } = await supabase
    .from("villagers")
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

  return NextResponse.json({ villager: data }, { status: 201 });
}
