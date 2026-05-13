import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { check_in_id, status, stripe_transaction_id } = body;

  if (!check_in_id || !status) {
    return NextResponse.json(
      { error: "check_in_id and status are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const update: Record<string, string> = { status };
  if (stripe_transaction_id) {
    update.stripe_transaction_id = stripe_transaction_id;
  }

  const { error } = await supabase
    .from("check_ins")
    .update(update)
    .eq("id", check_in_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
