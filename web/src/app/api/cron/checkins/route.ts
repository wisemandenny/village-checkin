import { timingSafeEqual } from "crypto";
import { createServerClient } from "@/lib/supabase/server";
import {
  DEFAULT_CHECKIN_SCHEDULE,
  isOpenAt,
  normalizeSchedule,
} from "@/lib/checkin-schedule";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SCHEDULE_KEY = "checkin_schedule";
const LAST_STATE_KEY = "checkin_schedule_last_state";
const ENABLED_KEY = "checkins_enabled";

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Cron entrypoint: reconciles `checkins_enabled` against the configured weekly
// schedule. Edge-triggered — it only writes when the desired state differs from
// the last applied scheduled state, so an admin's manual flip inside a window
// sticks until the next scheduled open/close boundary.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }

  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || !constantTimeEquals(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();

  const { data: rows, error } = await supabase
    .from("studio_settings")
    .select("key, value")
    .in("key", [SCHEDULE_KEY, LAST_STATE_KEY]);

  if (error) {
    return NextResponse.json(
      { error: "Failed to load schedule" },
      { status: 500 }
    );
  }

  const map = new Map((rows ?? []).map((r) => [r.key, r.value]));
  const scheduleRow = map.has(SCHEDULE_KEY)
    ? map.get(SCHEDULE_KEY)
    : DEFAULT_CHECKIN_SCHEDULE;
  const schedule = normalizeSchedule(scheduleRow);

  if (!schedule.enabled) {
    return NextResponse.json({ skipped: "schedule_disabled" });
  }

  const desired = isOpenAt(schedule, new Date());
  const lastState = map.get(LAST_STATE_KEY);
  const lastApplied = typeof lastState === "boolean" ? lastState : null;

  if (lastApplied === desired) {
    return NextResponse.json({
      changed: false,
      checkins_enabled: desired,
    });
  }

  const { error: writeError } = await supabase
    .from("studio_settings")
    .upsert(
      [
        { key: ENABLED_KEY, value: desired },
        { key: LAST_STATE_KEY, value: desired },
      ],
      { onConflict: "key" }
    );

  if (writeError) {
    return NextResponse.json(
      { error: "Failed to apply schedule" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    changed: true,
    checkins_enabled: desired,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
