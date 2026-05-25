import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function verifyAdmin(req: NextRequest): Promise<NextResponse | null> {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const { data } = await supabase
    .from("studio_settings")
    .select("value")
    .eq("key", "admin_password")
    .single();

  const dbPassword = data?.value;

  if (dbPassword && dbPassword !== null && dbPassword !== "null") {
    if (token === dbPassword) return null;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const envPassword = process.env.ADMIN_PASSWORD;
  if (!envPassword) {
    return NextResponse.json(
      { error: "Admin access is not configured" },
      { status: 503 }
    );
  }

  if (token !== envPassword) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
