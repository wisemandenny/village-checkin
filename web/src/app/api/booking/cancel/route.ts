import { validateProducerAccess } from "@/lib/booking-auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, device_id, booking_id } = body;

  if (!token || !device_id || !booking_id) {
    return NextResponse.json(
      { error: "token, device_id, and booking_id are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();
  const access = await validateProducerAccess(supabase, token, device_id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, villager_id, status")
    .eq("id", booking_id)
    .single();

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  if (booking.villager_id !== access.villager.id) {
    return NextResponse.json({ error: "Not your booking" }, { status: 403 });
  }

  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "Already cancelled" }, { status: 409 });
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", booking_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
