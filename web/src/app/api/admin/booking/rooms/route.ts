import { verifyAdmin } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const supabase = createServerClient();
  const [roomsRes, slotsRes] = await Promise.all([
    supabase.from("rooms").select("*").order("sort_order"),
    supabase.from("time_slots").select("*").order("sort_order"),
  ]);

  if (roomsRes.error || slotsRes.error) {
    return NextResponse.json({ error: "Failed to load configuration" }, { status: 500 });
  }

  return NextResponse.json({ rooms: roomsRes.data ?? [], time_slots: slotsRes.data ?? [] });
}

export async function POST(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const { type } = body;

  const supabase = createServerClient();

  if (type === "room") {
    const { name, sort_order, active } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("rooms")
      .insert({
        name: name.trim(),
        sort_order: sort_order ?? 0,
        active: active !== false,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ room: data }, { status: 201 });
  }

  if (type === "time_slot") {
    const { label, start_time, end_time, sort_order, active } = body;
    if (!label?.trim() || !start_time || !end_time) {
      return NextResponse.json(
        { error: "label, start_time, and end_time are required" },
        { status: 400 }
      );
    }
    const { data, error } = await supabase
      .from("time_slots")
      .insert({
        label: label.trim(),
        start_time,
        end_time,
        sort_order: sort_order ?? 0,
        active: active !== false,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ time_slot: data }, { status: 201 });
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}

export async function PUT(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const { type, id } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = createServerClient();

  if (type === "room") {
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;
    if (body.active !== undefined) updates.active = Boolean(body.active);

    const { data, error } = await supabase
      .from("rooms")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ room: data });
  }

  if (type === "time_slot") {
    const updates: Record<string, unknown> = {};
    if (body.label !== undefined) updates.label = String(body.label).trim();
    if (body.start_time !== undefined) updates.start_time = body.start_time;
    if (body.end_time !== undefined) updates.end_time = body.end_time;
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;
    if (body.active !== undefined) updates.active = Boolean(body.active);

    const { data, error } = await supabase
      .from("time_slots")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ time_slot: data });
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");
  if (!type || !id) {
    return NextResponse.json({ error: "type and id are required" }, { status: 400 });
  }

  const table = type === "room" ? "rooms" : type === "time_slot" ? "time_slots" : null;
  if (!table) return NextResponse.json({ error: "Invalid type" }, { status: 400 });

  const supabase = createServerClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
