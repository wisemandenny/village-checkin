import { verifyAdmin } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export async function GET(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "month";

  const supabase = createServerClient();

  if (view === "day") {
    const date = searchParams.get("date");
    if (!date) {
      return NextResponse.json({ error: "date is required for day view" }, { status: 400 });
    }

    const [roomsRes, slotsRes, bookingSlotsRes] = await Promise.all([
      supabase.from("rooms").select("*").eq("active", true).order("sort_order"),
      supabase.from("time_slots").select("*").eq("active", true).order("sort_order"),
      supabase
        .from("booking_slots")
        .select(
          `
          id, date, capacity, status, room_id, time_slot_id,
          bookings (
            id, status,
            villagers (id, display_name, email)
          )
        `
        )
        .eq("date", date),
    ]);

    if (roomsRes.error || slotsRes.error || bookingSlotsRes.error) {
      return NextResponse.json({ error: "Failed to load day view" }, { status: 500 });
    }

    const slotMap = new Map(
      (bookingSlotsRes.data ?? []).map((s) => [ `${s.room_id}:${s.time_slot_id}`, s ])
    );

    const grid = (roomsRes.data ?? []).map((room) => ({
      room,
      slots: (slotsRes.data ?? []).map((ts) => {
        const bs = slotMap.get(`${room.id}:${ts.id}`);
        const confirmed = (
          (bs?.bookings as Array<{ id: string; status: string; villagers: unknown }> | undefined) ??
          []
        ).filter((b) => b.status === "confirmed");
        return {
          time_slot: ts,
          booking_slot: bs
            ? {
                id: bs.id,
                capacity: bs.capacity,
                status: bs.status,
                remaining: bs.capacity - confirmed.length,
              }
            : null,
          bookings: confirmed.map((b) => ({
            id: b.id,
            villager: b.villagers as {
              id: string;
              display_name: string;
              email: string | null;
            } | null,
          })),
        };
      }),
    }));

    return NextResponse.json({ date, grid });
  }

  const month = searchParams.get("month");
  if (!month) {
    return NextResponse.json({ error: "month is required for month view" }, { status: 400 });
  }

  const { start, end } = monthBounds(month);

  const { data, error } = await supabase
    .from("booking_slots")
    .select(
      `
      id, date, room_id, time_slot_id, capacity, status,
      bookings (
        id, status,
        villagers (id, display_name)
      )
    `
    )
    .gte("date", start)
    .lte("date", end);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const days: Record<
    string,
    Array<{ booking_id: string; villager_id: string; display_name: string; room_id: string }>
  > = {};

  for (const slot of data ?? []) {
    const confirmed = (
      (slot.bookings as Array<{ id: string; status: string; villagers: unknown }> | undefined) ?? []
    ).filter((b) => b.status === "confirmed");
    for (const b of confirmed) {
      const villager = b.villagers as { id: string; display_name: string } | null;
      if (!villager) continue;
      if (!days[slot.date]) days[slot.date] = [];
      days[slot.date].push({
        booking_id: b.id,
        villager_id: villager.id,
        display_name: villager.display_name,
        room_id: slot.room_id,
      });
    }
  }

  return NextResponse.json({ month, days });
}
