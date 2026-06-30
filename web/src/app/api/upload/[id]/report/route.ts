import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const device_id = body?.device_id;

  if (!device_id || typeof device_id !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: villager } = await supabase
    .from("villagers")
    .select("id")
    .eq("device_id", device_id)
    .maybeSingle();

  if (!villager) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: upload } = await supabase
    .from("uploads")
    .select("id, villager_id, reported")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!upload) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (upload.villager_id === villager.id) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (upload.reported) {
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase
    .from("uploads")
    .update({ reported: true })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
