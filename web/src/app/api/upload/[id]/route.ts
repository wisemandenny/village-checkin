import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let device_id: string | null = req.nextUrl.searchParams.get("device_id");
  if (!device_id) {
    const body = await req.json().catch(() => null);
    device_id = body?.device_id ?? null;
  }

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
    .select("id, villager_id, deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (!upload) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (upload.deleted_at) {
    return NextResponse.json({ success: true });
  }
  if (upload.villager_id !== villager.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("uploads")
    .update({ deleted_at: new Date().toISOString(), deleted_by: "owner" })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
