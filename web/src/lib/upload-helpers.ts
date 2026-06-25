import type { SupabaseClient } from "@supabase/supabase-js";

export const DAILY_UPLOAD_LIMIT = 30;
export const DAILY_BYTE_BUDGET = 500 * 1024 * 1024; // 500 MB

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

export async function hasCheckInToday(
  supabase: SupabaseClient,
  villagerId: string
): Promise<boolean> {
  const { start, end } = todayBounds();
  const { data } = await supabase
    .from("check_ins")
    .select("id")
    .eq("villager_id", villagerId)
    .gte("created_at", start)
    .lt("created_at", end)
    .in("status", ["paid", "pending", "skipped"])
    .limit(1)
    .maybeSingle();
  return Boolean(data);
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
