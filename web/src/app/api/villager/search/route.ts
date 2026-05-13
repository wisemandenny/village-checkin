import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("display_name");

  if (!name || name.trim().length < 2) {
    return NextResponse.json({ villagers: [] });
  }

  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("villagers")
    .select("id, display_name, primary_role, first_visited_at")
    .ilike("display_name", `%${name.trim()}%`)
    .order("first_visited_at", { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ villagers: data ?? [] });
}
