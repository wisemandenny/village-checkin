import { verifyAdmin } from "@/lib/admin-auth";
import { maintenanceKey } from "@/lib/app-env";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("studio_settings")
    .select("key, value");

  if (error) {
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }

  const settings: Record<string, unknown> = {};
  for (const row of data ?? []) {
    if (row.key === "admin_password") {
      settings[row.key] = row.value ? "(set)" : null;
    } else {
      settings[row.key] = row.value;
    }
  }

  // Maintenance mode is stored per-environment; expose the value for THIS
  // environment under the stable logical `maintenance_mode` key the UI uses.
  settings.maintenance_mode = settings[maintenanceKey()] === true;

  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const { key, value } = body;

  if (!key || value === undefined) {
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  }

  const allowedKeys = ["payments_enabled", "animations_enabled", "admin_password", "maintenance_mode"];
  if (!allowedKeys.includes(key)) {
    return NextResponse.json({ error: "Invalid setting key" }, { status: 400 });
  }

  // Maintenance mode is scoped to the current environment so that local dev
  // (which shares prod's database) can't lock down production and vice versa.
  const storageKey = key === "maintenance_mode" ? maintenanceKey() : key;

  const supabase = createServerClient();
  const { error } = await supabase
    .from("studio_settings")
    .upsert({ key: storageKey, value }, { onConflict: "key" });

  if (error) {
    return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
