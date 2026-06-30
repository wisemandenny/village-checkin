import type { SupabaseClient } from "@supabase/supabase-js";

export const DAILY_BYTE_BUDGET = 2 * 1024 * 1024 * 1024; // 2 GB

export function todayBounds(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).toISOString();
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  ).toISOString();
  return { start, end };
}

export async function getDailyUploadUsage(
  supabase: SupabaseClient,
  villagerId: string
): Promise<{ count: number; bytes: number }> {
  const { start, end } = todayBounds();
  const { data } = await supabase
    .from("uploads")
    .select("size_bytes")
    .eq("villager_id", villagerId)
    .gte("created_at", start)
    .lt("created_at", end);

  const rows = data ?? [];
  return {
    count: rows.length,
    bytes: rows.reduce((sum, r) => sum + (r.size_bytes ?? 0), 0),
  };
}
