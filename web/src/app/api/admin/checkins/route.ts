import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { normalizeAdminCheckInFields } from "@/lib/checkin-status";

export async function GET(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const supabase = createServerClient();
  const villagerId = req.nextUrl.searchParams.get("villager_id");

  let query = supabase.from("check_ins").select("*, villagers(display_name)");

  if (villagerId) {
    query = query.eq("villager_id", villagerId);
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ checkins: data });
}

export async function POST(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const supabase = createServerClient();

  const intentAmount = body.intent_amount ?? 0;
  const { status, intent_amount } = normalizeAdminCheckInFields({
    status: body.status || "paid",
    intent_amount: intentAmount,
  });

  const { data, error } = await supabase
    .from("check_ins")
    .insert({
      villager_id: body.villager_id,
      intent_amount: intent_amount ?? intentAmount,
      payment_method: body.payment_method || "cash",
      status: status || "paid",
      created_at: body.created_at || new Date().toISOString(),
      stripe_transaction_id: body.stripe_transaction_id || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ checkin: data }, { status: 201 });
}
