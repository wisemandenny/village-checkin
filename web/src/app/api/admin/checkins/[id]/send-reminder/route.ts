import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { mintPayToken } from "@/lib/pay-token";
import { buildReminder } from "@/lib/reminder-email";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface ReminderCheckIn {
  id: string;
  created_at: string;
  status: string;
  reminder_1h_sent_at: string | null;
  reminder_24h_sent_at: string | null;
  villagers: { email: string | null; display_name: string | null } | null;
}

// Admin-only: manually send an unpaid-check-in reminder email for a single
// check-in (the same email the cron sends). Unlike the cron this ignores the
// "already sent" guard so the studio can re-nudge on demand, but it still stamps
// the bookkeeping column so the automated job won't double up afterward.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email is not configured (RESEND_API_KEY / EMAIL_FROM missing)" },
      { status: 503 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_BASE_URL is not set" }, { status: 503 });
  }

  const { id } = await params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("check_ins")
    .select(
      "id, created_at, status, reminder_1h_sent_at, reminder_24h_sent_at, villagers ( email, display_name )"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const checkIn = data as unknown as ReminderCheckIn | null;
  if (!checkIn) {
    return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
  }

  // Reminders only make sense for visits that still owe payment. 'skipped'
  // (payments were off) and settled statuses owe nothing, so only 'pending'
  // qualifies — mirroring the cron's candidate filter.
  if (checkIn.status !== "pending") {
    return NextResponse.json(
      { error: "Reminders can only be sent for pending check-ins" },
      { status: 400 }
    );
  }

  const email = checkIn.villagers?.email;
  if (!email) {
    return NextResponse.json(
      { error: "That villager has no email on file" },
      { status: 400 }
    );
  }

  const token = mintPayToken(checkIn.id);
  if (!token) {
    return NextResponse.json({ error: "PAY_TOKEN_SECRET is not set" }, { status: 503 });
  }
  const payUrl = `${baseUrl.replace(/\/$/, "")}/pay/${token}`;

  // Match the cron's per-row logic: past 24h use the 24h variant, otherwise 1h.
  const ageMs = Date.now() - new Date(checkIn.created_at).getTime();
  const kind: "1h" | "24h" = ageMs >= DAY_MS ? "24h" : "1h";

  const message = buildReminder(
    kind,
    checkIn.villagers?.display_name ?? null,
    payUrl,
    checkIn.created_at
  );

  const ok = await sendEmail({ to: email, ...message });
  if (!ok) {
    return NextResponse.json({ error: "Failed to send reminder email" }, { status: 502 });
  }

  // Record the send so the automated cron doesn't send the same variant again.
  // Only set columns still null so an earlier automated timestamp is preserved.
  const column = kind === "1h" ? "reminder_1h_sent_at" : "reminder_24h_sent_at";
  const alreadyStamped =
    kind === "1h" ? checkIn.reminder_1h_sent_at : checkIn.reminder_24h_sent_at;
  if (!alreadyStamped) {
    await supabase
      .from("check_ins")
      .update({ [column]: new Date().toISOString() })
      .eq("id", checkIn.id);
  }

  return NextResponse.json({ ok: true, kind, email });
}
