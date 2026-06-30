import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { mintPayToken } from "@/lib/pay-token";
import { buildReminder } from "@/lib/reminder-email";
import { randomUUID } from "crypto";

// Admin-only: sends BOTH unpaid-check-in reminder emails (the 1h then the 24h
// variant) to a chosen villager, one after the other, so the studio can confirm
// the email-sending loop and the templates render correctly in a real inbox.
// This does not touch the reminder bookkeeping columns — it is purely a test.
export async function POST(req: NextRequest) {
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
    return NextResponse.json(
      { error: "NEXT_PUBLIC_BASE_URL is not set" },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const villagerId = body?.villager_id as string | undefined;
  if (!villagerId) {
    return NextResponse.json({ error: "villager_id is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: villager } = await supabase
    .from("villagers")
    .select("id, email, display_name")
    .eq("id", villagerId)
    .maybeSingle();

  if (!villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }
  if (!villager.email) {
    return NextResponse.json(
      { error: "That villager has no email on file" },
      { status: 400 }
    );
  }

  // Use the villager's most recent check-in for a pay link that actually
  // resolves; fall back to a synthetic id (the email still sends, the link just
  // shows "expired") so the test works even for villagers with no check-ins.
  const { data: latestCheckIn } = await supabase
    .from("check_ins")
    .select("id, created_at")
    .eq("villager_id", villager.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const checkInId = latestCheckIn?.id ?? randomUUID();
  const visitDate = latestCheckIn?.created_at ?? null;
  const token = mintPayToken(checkInId);
  if (!token) {
    return NextResponse.json(
      { error: "PAY_TOKEN_SECRET is not set" },
      { status: 503 }
    );
  }
  const payUrl = `${baseUrl.replace(/\/$/, "")}/pay/${token}`;

  // Send sequentially: 1h first, then 24h, mirroring the real reminder order.
  const results: { kind: "1h" | "24h"; ok: boolean }[] = [];
  for (const kind of ["1h", "24h"] as const) {
    const message = buildReminder(kind, villager.display_name, payUrl, visitDate);
    const ok = await sendEmail({ to: villager.email, ...message });
    results.push({ kind, ok });
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json(
    {
      email: villager.email,
      sent_1h: results[0]?.ok ?? false,
      sent_24h: results[1]?.ok ?? false,
    },
    { status: allOk ? 200 : 502 }
  );
}
