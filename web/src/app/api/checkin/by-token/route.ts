import { createServerClient } from "@/lib/supabase/server";
import { verifyPayToken } from "@/lib/pay-token";
import { isPaymentSettled } from "@/lib/checkin-status";
import { resolveExclusive } from "@/lib/exclusive-tier";
import { NextRequest, NextResponse } from "next/server";

// Resolves a signed pay-link token (from an unpaid-check-in reminder email) into
// the check-in it points at, so the /pay page can show the payment screen. The
// token both authenticates the request and identifies the check-in; no device
// recovery is needed. Returns only the minimal fields the pay screen renders.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const verified = verifyPayToken(token);
  if (!verified) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const supabase = createServerClient();

  const { data: checkIn } = await supabase
    .from("check_ins")
    .select("id, status, intent_amount, villager_id")
    .eq("id", verified.checkInId)
    .maybeSingle();

  if (!checkIn) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: villager } = await supabase
    .from("villagers")
    .select("id, display_name, ig_handle, roles")
    .eq("id", checkIn.villager_id)
    .maybeSingle();

  // Exclusive-tier villagers pledge monthly, so the pay link must show the
  // subscription flow (not the one-time amount) — matching what they saw at
  // check-in. Everyone else gets the one-time flow.
  const isExclusive = villager
    ? await resolveExclusive(supabase, {
        id: villager.id,
        ig_handle: villager.ig_handle,
        roles: villager.roles,
      })
    : false;

  return NextResponse.json({
    check_in: {
      id: checkIn.id,
      status: checkIn.status,
      intent_amount: checkIn.intent_amount,
    },
    villager: { display_name: villager?.display_name ?? null },
    is_exclusive: isExclusive,
    already_paid: isPaymentSettled(checkIn.status),
  });
}
