import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { normalizeAdminCheckInFields } from "@/lib/checkin-status";

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

  // $0 "mark paid" (or edit) is a fee waiver, not revenue. When only one of
  // status/amount is in the payload, load the other from the existing row so
  // "set amount to 0 while status is paid" still becomes waived.
  if ("status" in updates || "intent_amount" in updates) {
    let status = updates.status as string | undefined;
    let intentAmount = updates.intent_amount as number | undefined;

    if (status === undefined || intentAmount === undefined) {
      const { data: current } = await supabase
        .from("check_ins")
        .select("status, intent_amount")
        .eq("id", id)
        .single();
      if (current) {
        status = status ?? (current.status as string);
        intentAmount =
          intentAmount ?? (current.intent_amount as number);
      }
    }

    const normalized = normalizeAdminCheckInFields({
      status,
      intent_amount: intentAmount,
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
