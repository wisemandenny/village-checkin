import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { check_in_id, amount, request_id } = body;

  if (!check_in_id || !amount || !request_id) {
    return NextResponse.json(
      { error: "check_in_id, amount, and request_id are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const channel = supabase.channel("terminal_room");

  await channel.send({
    type: "broadcast",
    event: "payment_request",
    payload: { check_in_id, amount, request_id },
  });

  return NextResponse.json({ success: true });
}
