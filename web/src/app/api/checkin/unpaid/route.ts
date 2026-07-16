import { createServerClient } from "@/lib/supabase/server";
import { ACTIVE_STATUSES } from "@/lib/subscription-sync";
import { resolveExclusive, ELDER_ROLE } from "@/lib/exclusive-tier";
import { NextRequest, NextResponse } from "next/server";

// Lists a villager's past check-ins that were never paid for (status not
// settled), so they can settle a session they attended but didn't pay for —
// notably while check-ins are closed. Also returns the tier/subscription flags
// the payment screen needs.
export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("device_id");

  if (!deviceId) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: villager } = await supabase
    .from("villagers")
    .select("id, ig_handle, roles")
    .contains("device_ids", [deviceId])
    .single();

  if (!villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  const { data: checkIns } = await supabase
    .from("check_ins")
    .select("id, status, payment_method, intent_amount, created_at")
    .eq("villager_id", villager.id)
    .not("status", "in", '("paid","waived")')
    .order("created_at", { ascending: false });

  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("villager_id", villager.id);

  const hasActiveSubscription = (subscriptions ?? []).some((s) =>
    ACTIVE_STATUSES.has(s.status as string)
  );

  const isExclusive = await resolveExclusive(supabase, {
    id: villager.id,
    ig_handle: villager.ig_handle,
    roles: villager.roles,
  });

  const isElder = (villager.roles ?? []).some(
    (r: string) => r.toLowerCase() === ELDER_ROLE
  );

  return NextResponse.json({
    check_ins: checkIns ?? [],
    has_active_subscription: hasActiveSubscription,
    is_exclusive: isExclusive,
    is_elder: isElder,
  });
}
