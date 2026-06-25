import { appEnv } from "@/lib/app-env";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("studio_settings")
    .select("key, value")
    .in("key", ["payments_enabled", "animations_enabled", "checkins_enabled"]);

  if (error) {
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }

  // Check-ins default ON (a missing row means the studio is open) so existing
  // deployments keep recording visits until an admin explicitly closes them.
  const settings: Record<string, unknown> = {
    payments_enabled: false,
    animations_enabled: false,
    checkins_enabled: true,
    app_env: appEnv(),
  };

  for (const row of data ?? []) {
    settings[row.key] = row.value;
  }

  settings.app_env = appEnv();

  return NextResponse.json(settings);
}
