import { createServerClient } from "@/lib/supabase/server";
import { deleteUploadObject } from "@/lib/r2";
import { verifyAdmin } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const supabase = createServerClient();

  const { data: upload, error: lookupError } = await supabase
    .from("uploads")
    .select("id, object_key")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!upload) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deleteUploadObject(upload.object_key);

  const { error } = await supabase.from("uploads").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
