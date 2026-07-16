import { sendBookingReminderEmail } from "@/lib/email";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate = tomorrow.toISOString().slice(0, 10);

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      `
      id, reminder_sent_at,
      villagers (display_name, email),
      booking_slots!inner (
        date,
        rooms (name),
        time_slots (label, start_time, end_time)
      )
    `
    )
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .eq("booking_slots.date", targetDate);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;

  for (const booking of bookings ?? []) {
    const villager = booking.villagers as unknown as {
      display_name: string;
      email: string | null;
    } | null;
    const slot = booking.booking_slots as unknown as {
      date: string;
      rooms: { name: string } | null;
      time_slots: { label: string; start_time: string; end_time: string } | null;
    };

    if (!villager?.email) {
      skipped++;
      continue;
    }

    const result = await sendBookingReminderEmail({
      to: villager.email,
      displayName: villager.display_name,
      date: slot.date,
      roomName: slot.rooms?.name ?? "Studio",
      slotLabel: slot.time_slots?.label ?? "",
      startTime: slot.time_slots?.start_time ?? "09:00",
      endTime: slot.time_slots?.end_time ?? "21:00",
      bookingId: booking.id,
    });

    if (result.sent || result.skipped) {
      await supabase
        .from("bookings")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id);
      if (result.sent) sent++;
      else skipped++;
    }
  }

  return NextResponse.json({
    date: targetDate,
    processed: (bookings ?? []).length,
    sent,
    skipped,
  });
}
