import { validateProducerAccess } from "@/lib/booking-auth";
import { sendBookingConfirmationEmail } from "@/lib/email";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, device_id, booking_slot_ids } = body;

  if (!token || !device_id || !Array.isArray(booking_slot_ids) || booking_slot_ids.length === 0) {
    return NextResponse.json(
      { error: "token, device_id, and booking_slot_ids are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();
  const access = await validateProducerAccess(supabase, token, device_id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { villager } = access;
  const createdIds: string[] = [];
  const errors: Array<{ booking_slot_id: string; error: string }> = [];

  for (const slotId of booking_slot_ids) {
    const { data, error } = await supabase.rpc("claim_booking_slot", {
      p_booking_slot_id: slotId,
      p_villager_id: villager.id,
    });

    if (error) {
      const msg = error.message.includes("SLOT_FULL")
        ? "Slot is full"
        : error.message.includes("SLOT_CLOSED")
          ? "Slot is closed"
          : error.message.includes("ALREADY_BOOKED")
            ? "Already booked"
            : error.message.includes("SLOT_NOT_FOUND")
              ? "Slot not found"
              : error.message;
      errors.push({ booking_slot_id: slotId, error: msg });
    } else if (data) {
      createdIds.push(data as string);
    }
  }

  if (createdIds.length === 0) {
    return NextResponse.json(
      { error: "No slots were booked", details: errors },
      { status: 409 }
    );
  }

  const { data: bookingDetails } = await supabase
    .from("bookings")
    .select(
      `
      id,
      booking_slots (
        date,
        rooms (name),
        time_slots (label, start_time, end_time)
      )
    `
    )
    .in("id", createdIds);

  if (villager.email && bookingDetails?.length) {
    await sendBookingConfirmationEmail({
      to: villager.email,
      displayName: villager.display_name,
      bookings: bookingDetails.map((b) => {
        const slot = b.booking_slots as unknown as {
          date: string;
          rooms: { name: string } | null;
          time_slots: { label: string; start_time: string; end_time: string } | null;
        };
        return {
          bookingId: b.id,
          date: slot.date,
          roomName: slot.rooms?.name ?? "Studio",
          slotLabel: slot.time_slots?.label ?? "",
          startTime: slot.time_slots?.start_time ?? "09:00",
          endTime: slot.time_slots?.end_time ?? "12:00",
        };
      }),
    });
  }

  return NextResponse.json({
    booked: createdIds.length,
    booking_ids: createdIds,
    errors: errors.length ? errors : undefined,
  });
}
