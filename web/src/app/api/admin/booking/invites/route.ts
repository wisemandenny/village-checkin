import { verifyAdmin } from "@/lib/admin-auth";
import { generateInviteToken } from "@/lib/booking-auth";
import { sendBookingInviteEmail } from "@/lib/email";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/villager-dedupe";
import { NextRequest, NextResponse } from "next/server";

const DEFAULT_EXPIRY_DAYS = 30;

export async function GET(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("booking_invites")
    .select("id, email, token, villager_id, status, expires_at, created_at, created_by")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ invites: data ?? [] });
}

export async function POST(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const { email, expires_in_days } = body;

  if (!email?.trim()) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const normalized = normalizeEmail(email);
  const supabase = createServerClient();

  const { data: existingVillager } = await supabase
    .from("villagers")
    .select("id")
    .ilike("email", normalized)
    .limit(1)
    .maybeSingle();

  const days = Math.max(1, Number(expires_in_days) || DEFAULT_EXPIRY_DAYS);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  const token = generateInviteToken();

  const { data: invite, error } = await supabase
    .from("booking_invites")
    .insert({
      email: normalized,
      token,
      villager_id: existingVillager?.id ?? null,
      status: existingVillager ? "accepted" : "pending",
      expires_at: expiresAt.toISOString(),
      created_by: "admin",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await sendBookingInviteEmail({
    to: normalized,
    token,
    expiresAt: expiresAt.toISOString(),
  });

  return NextResponse.json({ invite }, { status: 201 });
}
