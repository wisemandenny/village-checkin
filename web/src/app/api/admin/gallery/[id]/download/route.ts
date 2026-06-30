import { createServerClient } from "@/lib/supabase/server";
import { getUploadObject } from "@/lib/r2";
import { verifyAdmin } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";

// Same-origin download proxy for the admin gallery. The client fetches this with
// the admin bearer token and saves the blob, so downloads never hit R2 from the
// browser and don't depend on the bucket's CORS config.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const supabase = createServerClient();

  const { data: upload, error } = await supabase
    .from("uploads")
    .select("id, object_key, content_type")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!upload) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const object = await getUploadObject(upload.object_key);
  if (!object) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  return new NextResponse(object.body, {
    headers: {
      "Content-Type": object.contentType,
      "Content-Disposition": `attachment; filename="${upload.id}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
