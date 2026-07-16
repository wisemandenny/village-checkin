import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
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
