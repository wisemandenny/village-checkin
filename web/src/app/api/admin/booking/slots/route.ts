import { verifyAdmin } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const supabase = createServerClient();
  let query = supabase
    .from("booking_slots")
    .select(
      `
      *,
      rooms (id, name, sort_order),
      time_slots (id, label, start_time, end_time, sort_order),
      bookings (id, status, villager_id, villagers (display_name))
    `
    )
    .order("date");

  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ slots: data ?? [] });
}

export async function POST(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const { action } = body;
  const supabase = createServerClient();

  if (action === "open_day") {
    const { date, capacity, room_ids, time_slot_ids } = body;
    if (!date || !Array.isArray(room_ids) || !Array.isArray(time_slot_ids)) {
      return NextResponse.json(
        { error: "date, room_ids, and time_slot_ids are required" },
        { status: 400 }
      );
    }

    const cap = Math.max(1, Number(capacity) || 1);
    const rows = [];
    for (const room_id of room_ids) {
      for (const time_slot_id of time_slot_ids) {
        rows.push({
          date,
          room_id,
          time_slot_id,
          capacity: cap,
          status: "open",
        });
      }
    }

    const { data, error } = await supabase
      .from("booking_slots")
      .upsert(rows, { onConflict: "date,room_id,time_slot_id" })
      .select();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ slots: data }, { status: 201 });
  }

  if (action === "update_slot") {
    const { id, capacity, status } = body;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (capacity !== undefined) updates.capacity = Math.max(1, Number(capacity));
    if (status !== undefined) updates.status = status;

    const { data, error } = await supabase
      .from("booking_slots")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (status === "closed") {
      await supabase
        .from("bookings")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("booking_slot_id", id)
        .eq("status", "confirmed");
    }

    return NextResponse.json({ slot: data });
  }

  if (action === "close_day") {
    const { date } = body;
    if (!date) return NextResponse.json({ error: "date is required" }, { status: 400 });

    await supabase.rpc("cancel_bookings_for_date", { p_date: date });

    const { data, error } = await supabase
      .from("booking_slots")
      .update({ status: "closed" })
      .eq("date", date)
      .select();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ slots: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
