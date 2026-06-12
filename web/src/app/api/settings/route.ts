import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("studio_settings")
    .select("key, value")
    .in("key", ["payments_enabled", "animations_enabled"]);

  if (error) {
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }

  const settings: Record<string, unknown> = {
    payments_enabled: false,
    animations_enabled: false,
  };

  for (const row of data ?? []) {
    settings[row.key] = row.value;
  }

  return NextResponse.json(settings);
}
