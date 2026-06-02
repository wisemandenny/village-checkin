import { createServerClient } from "@/lib/supabase/server";
import { syncMarketingOptIn } from "@/lib/kit-sync";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, display_name, email, ig_handle, roles, instruments } = body;
  // Default to opted-in when the flag is omitted (preserves prior behavior).
  const marketing_opt_in =
    body.marketing_opt_in === undefined ? true : Boolean(body.marketing_opt_in);

  if (!device_id || !display_name || !email) {
    return NextResponse.json(
      { error: "device_id, display_name, and email are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const record: Record<string, unknown> = { device_id, display_name, email, marketing_opt_in };
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

  // Mirror the opt-in choice into Kit. Non-blocking: a Kit failure must not
  // fail registration.
  const { kitSubscriberId } = await syncMarketingOptIn({
    email,
    firstName: display_name,
    optIn: marketing_opt_in,
    kitSubscriberId: null,
  });
  if (kitSubscriberId) {
    await supabase
      .from("villagers")
      .update({ kit_subscriber_id: kitSubscriberId })
      .eq("id", data.id);
  }

  return NextResponse.json({ villager: data }, { status: 201 });
}
