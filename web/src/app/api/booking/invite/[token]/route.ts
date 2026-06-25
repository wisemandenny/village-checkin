import {
  getInviteByToken,
  isInviteExpired,
  resolveInviteVillager,
} from "@/lib/booking-auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const deviceId = req.headers.get("x-device-id") || req.nextUrl.searchParams.get("device_id");

  const supabase = createServerClient();
  const invite = await getInviteByToken(supabase, token);

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  }

  if (invite.status === "expired" || isInviteExpired(invite)) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  const villagerId = await resolveInviteVillager(supabase, invite);

  let villager = null;
  let needsOnboarding = !villagerId;

  if (villagerId) {
    const { data } = await supabase
      .from("villagers")
      .select("id, device_id, display_name, email, roles")
      .eq("id", villagerId)
      .single();
    villager = data;

    // Invite token is sufficient auth to bind this device for returning villagers.
    if (villager && deviceId && villager.device_id !== deviceId) {
      await supabase.from("villagers").update({ device_id: deviceId }).eq("id", villager.id);
      villager = { ...villager, device_id: deviceId };
    }

    if (villager && deviceId && villager.device_id !== deviceId) {
      needsOnboarding = true;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: openSlots } = await supabase
    .from("booking_slots")
    .select(
      `
      id, date, capacity, status,
      rooms (id, name),
      time_slots (id, label, start_time, end_time),
      bookings (id, status, villager_id)
    `
    )
    .eq("status", "open")
    .gte("date", today)
    .order("date");

  const slots = (openSlots ?? []).map((slot) => {
    const confirmed =
      slot.bookings?.filter((b: { status: string }) => b.status === "confirmed") ?? [];
    const mine = villagerId
      ? confirmed.some((b: { villager_id: string }) => b.villager_id === villagerId)
      : false;
    return {
      id: slot.id,
      date: slot.date,
      capacity: slot.capacity,
      remaining: slot.capacity - confirmed.length,
      room: slot.rooms,
      time_slot: slot.time_slots,
      booked_by_me: mine,
    };
  });

  let myBookings: unknown[] = [];
  if (villagerId && deviceId && villager?.device_id === deviceId) {
    const { data } = await supabase
      .from("bookings")
      .select(
        `
        id, status, created_at,
        booking_slots (
          id, date,
          rooms (name),
          time_slots (label, start_time, end_time)
        )
      `
      )
      .eq("villager_id", villagerId)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false });
    myBookings = data ?? [];
  }

  return NextResponse.json({
    invite: {
      email: invite.email,
      status: invite.status,
      expires_at: invite.expires_at,
    },
    needs_onboarding: needsOnboarding,
    villager: villager
      ? {
          id: villager.id,
          display_name: villager.display_name,
          email: villager.email,
        }
      : null,
    open_slots: slots.filter((s) => s.remaining > 0 || s.booked_by_me),
    my_bookings: myBookings,
  });
}
