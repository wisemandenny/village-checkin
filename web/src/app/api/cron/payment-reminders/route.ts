import { createServerClient } from "@/lib/supabase/server";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { mintPayToken } from "@/lib/pay-token";
import { buildReminder } from "@/lib/reminder-email";
import { NextRequest, NextResponse } from "next/server";

// Scheduled job (hit by a GitHub Actions cron) that nudges villagers who checked
// in but never finished paying. Their check-in sits in status 'pending' with
// payment_method 'deferred' (they abandoned the Stripe flow). We send a reminder
// once at 1h and once at 24h, recording each on the check-in so it never repeats.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Safety window: never email check-ins older than this. Prevents the first run
// after deploy (or a long outage) from blasting a backlog of ancient pending
// rows. Tune as needed.
const MAX_AGE_MS = 3 * DAY_MS;

interface ReminderRow {
  id: string;
  created_at: string;
  reminder_1h_sent_at: string | null;
  reminder_24h_sent_at: string | null;
  villagers: { email: string | null; display_name: string | null } | null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "email not configured" }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_BASE_URL not set" }, { status: 500 });
  }

  const supabase = createServerClient();
  const now = Date.now();
  const oneHourAgoIso = new Date(now - HOUR_MS).toISOString();
  const windowStartIso = new Date(now - MAX_AGE_MS).toISOString();

  // Candidates: unpaid, deferred check-ins at least 1h old but within the safety
  // window. The 24h cohort is a subset, handled by the per-row age check below.
  const { data, error } = await supabase
    .from("check_ins")
    .select(
      "id, created_at, reminder_1h_sent_at, reminder_24h_sent_at, villagers ( email, display_name )"
    )
    .eq("status", "pending")
    .eq("payment_method", "deferred")
    .gte("created_at", windowStartIso)
    .lte("created_at", oneHourAgoIso);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as ReminderRow[];
  const summary = { scanned: rows.length, sent1h: 0, sent24h: 0, skipped: 0, errors: 0 };

  for (const row of rows) {
    const email = row.villagers?.email;
    if (!email) {
      summary.skipped++;
      continue;
    }

    const ageMs = now - new Date(row.created_at).getTime();

    // Pick the most relevant unsent reminder. Past 24h we only send the 24h
    // nudge (never a belated 1h one), so a backlog produces at most one email.
    let kind: "1h" | "24h" | null = null;
    if (ageMs >= DAY_MS && !row.reminder_24h_sent_at) {
      kind = "24h";
    } else if (ageMs < DAY_MS && !row.reminder_1h_sent_at) {
      kind = "1h";
    }

    if (!kind) {
      summary.skipped++;
      continue;
    }

    const column = kind === "1h" ? "reminder_1h_sent_at" : "reminder_24h_sent_at";
    const stampIso = new Date().toISOString();

    // Claim the reminder before sending: a conditional update that only succeeds
    // while the column is still null. If a concurrent run already claimed it,
    // zero rows come back and we skip — this is the dedupe guard.
    const { data: claimed } = await supabase
      .from("check_ins")
      .update({ [column]: stampIso })
      .eq("id", row.id)
      .is(column, null)
      .select("id");

    if (!claimed || claimed.length === 0) {
      summary.skipped++;
      continue;
    }

    const token = mintPayToken(row.id);
    if (!token) {
      // PAY_TOKEN_SECRET missing: roll back the claim so a fixed deploy retries.
      await supabase.from("check_ins").update({ [column]: null }).eq("id", row.id);
      summary.errors++;
      continue;
    }

    const payUrl = `${baseUrl.replace(/\/$/, "")}/pay/${token}`;
    const message = buildReminder(kind, row.villagers?.display_name ?? null, payUrl, row.created_at);

    const ok = await sendEmail({ to: email, ...message });
    if (ok) {
      if (kind === "1h") summary.sent1h++;
      else summary.sent24h++;
    } else {
      // Send failed: undo the claim so the next run can try again.
      await supabase.from("check_ins").update({ [column]: null }).eq("id", row.id);
      summary.errors++;
    }
  }

  return NextResponse.json(summary);
}
