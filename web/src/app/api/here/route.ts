import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Public board data: villagers who checked in today and completed (paid or
// skipped), excluding test accounts. Returns only safe public fields.
export async function GET() {
  const supabase = createServerClient();

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).toISOString();
  const tomorrowStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  ).toISOString();

  const { data, error } = await supabase
    .from("check_ins")
    .select(
      "created_at, villagers!inner(id, display_name, avatar_head, avatar_body, test_account)"
    )
    .in("status", ["paid", "skipped"])
    .eq("villagers.test_account", false)
    .gte("created_at", todayStart)
    .lt("created_at", tomorrowStart)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A villager can have multiple check-ins; keep one entry each, in first-seen
  // order.
  const seen = new Set<string>();
  const villagers: {
    id: string;
    display_name: string;
    avatar_head: number | null;
    avatar_body: number | null;
  }[] = [];

  for (const row of data ?? []) {
    const v = (row as { villagers: unknown }).villagers as {
      id: string;
      display_name: string;
      avatar_head: number | null;
      avatar_body: number | null;
    } | null;
    if (!v || seen.has(v.id)) continue;
    seen.add(v.id);
    villagers.push({
      id: v.id,
      display_name: v.display_name,
      avatar_head: v.avatar_head,
      avatar_body: v.avatar_body,
    });
  }

  return NextResponse.json({ villagers });
}
