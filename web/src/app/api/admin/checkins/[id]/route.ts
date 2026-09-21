import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { normalizeAdminCheckInFields } from "@/lib/checkin-status";
import { recordContribution } from "@/lib/contributions";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const supabase = createServerClient();

  const updates: Record<string, unknown> = {};
  const allowedFields = [
    "intent_amount",
    "payment_method",
    "status",
    "created_at",
    "stripe_transaction_id",
  ];

  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  // $0 "mark paid" (or edit) is a fee waiver, not revenue, unless the method
  // is prepaid. Fields missing from the payload are loaded from the existing
  // row so a partial edit is judged against the check-in's real state.
  if ("status" in updates || "intent_amount" in updates || "payment_method" in updates) {
    let status = updates.status as string | undefined;
    let intentAmount = updates.intent_amount as number | undefined;
    let paymentMethod = updates.payment_method as string | undefined;

    if (status === undefined || intentAmount === undefined || paymentMethod === undefined) {
      const { data: current } = await supabase
        .from("check_ins")
        .select("status, intent_amount, payment_method")
        .eq("id", id)
        .single();
      if (current) {
        status = status ?? (current.status as string);
        intentAmount = intentAmount ?? (current.intent_amount as number);
        paymentMethod = paymentMethod ?? (current.payment_method as string);
      }
    }

    const normalized = normalizeAdminCheckInFields({
      status,
      intent_amount: intentAmount,
      payment_method: paymentMethod,
    });
    if (normalized.status !== undefined) updates.status = normalized.status;
    if (normalized.intent_amount !== undefined) {
      updates.intent_amount = normalized.intent_amount;
    }
  }

  const { data, error } = await supabase
    .from("check_ins")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (
    data &&
    data.status === "paid" &&
    data.intent_amount > 0 &&
    data.payment_method !== "subscription" &&
    data.payment_method !== "elder"
  ) {
    await recordContribution(supabase, {
      villagerId: data.villager_id,
      amountCents: data.intent_amount,
      source: "admin",
      checkInId: data.id,
      stripeTransactionId: data.stripe_transaction_id,
      createdAt: data.created_at,
      replaceExisting: true,
    });
  }

  return NextResponse.json({ checkin: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const supabase = createServerClient();

  const { error } = await supabase.from("check_ins").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
