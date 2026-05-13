import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, intent_amount, payment_method } = body;

  if (!device_id || intent_amount === undefined || !payment_method) {
    return NextResponse.json(
      { error: "device_id, intent_amount, and payment_method are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  // Look up attendee
  const { data: attendee, error: lookupErr } = await supabase
    .from("attendees")
    .select("id")
    .eq("device_id", device_id)
    .single();

  if (lookupErr || !attendee) {
    return NextResponse.json({ error: "Attendee not found" }, { status: 404 });
  }

  // Update last_visited_at
  await supabase
    .from("attendees")
    .update({ last_visited_at: new Date().toISOString() })
    .eq("id", attendee.id);

  // Create check-in record
  const { data: checkIn, error: insertErr } = await supabase
    .from("check_ins")
    .insert({
      attendee_id: attendee.id,
      intent_amount,
      payment_method,
      status: payment_method === "skipped" ? "paid" : "pending",
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ check_in: checkIn }, { status: 201 });
}
