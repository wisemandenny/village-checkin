import { verifyAdmin } from "@/lib/admin-auth";
import { maintenanceKey } from "@/lib/app-env";
import {
  DEFAULT_CHECKIN_SCHEDULE,
  normalizeSchedule,
} from "@/lib/checkin-schedule";
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

  // Check-ins default ON when the row is missing (e.g. a DB that predates the
  // setting) so the toggle reflects the real behavior.
  settings.checkins_enabled = settings.checkins_enabled !== false;

  // Normalize the schedule (defaults when the row is missing or partial) so the
  // admin UI always renders a complete, valid configuration.
  settings.checkin_schedule = normalizeSchedule(
    settings.checkin_schedule ?? DEFAULT_CHECKIN_SCHEDULE
  );

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

  const allowedKeys = ["payments_enabled", "checkins_enabled", "admin_password", "maintenance_mode", "checkin_schedule"];
  if (!allowedKeys.includes(key)) {
    return NextResponse.json({ error: "Invalid setting key" }, { status: 400 });
  }

  // Maintenance mode is scoped to the current environment so that local dev
  // (which shares prod's database) can't lock down production and vice versa.
  const storageKey = key === "maintenance_mode" ? maintenanceKey() : key;

  // The schedule is stored normalized so the cron and UI never read partial
  // or malformed config.
  const storageValue =
    key === "checkin_schedule" ? normalizeSchedule(value) : value;

  const supabase = createServerClient();
  const { error } = await supabase
    .from("studio_settings")
    .upsert({ key: storageKey, value: storageValue }, { onConflict: "key" });

  if (error) {
    return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
  }

  // Editing the schedule clears the cron's last-applied marker so the next tick
  // re-asserts the new schedule immediately rather than waiting for the next
  // open/close boundary.
  if (key === "checkin_schedule") {
    await supabase
      .from("studio_settings")
      .delete()
      .eq("key", "checkin_schedule_last_state");
  }

  return NextResponse.json({ success: true });
}
