import { createServerClient } from "@/lib/supabase/server";
import { ACTIVE_STATUSES } from "@/lib/subscription-sync";
import { resolveExclusive, ELDER_ROLE } from "@/lib/exclusive-tier";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, intent_amount = 0 } = body;

  if (!device_id) {
    return NextResponse.json(
      { error: "device_id is required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  // Look up villager
  const { data: villager, error: lookupErr } = await supabase
    .from("villagers")
    .select("id, test_account, roles, ig_handle")
    .eq("device_id", device_id)
    .single();

  if (lookupErr || !villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  // Studio feature flags. Check-ins default ON (a missing row means open) so
  // existing deployments keep recording visits; payments default OFF.
  const { data: settingsRows } = await supabase
    .from("studio_settings")
    .select("key, value")
    .in("key", ["payments_enabled", "checkins_enabled"]);
  const settings = new Map((settingsRows ?? []).map((r) => [r.key, r.value]));
  const checkinsEnabled = settings.get("checkins_enabled") !== false;
  const paymentsEnabled = settings.get("payments_enabled") === true;

  // When the studio has check-ins closed, no new visit is recorded. The client
  // shows the "check-ins closed" landing instead (where villagers can still
  // register, subscribe, and pay off a past session).
  if (!checkinsEnabled) {
    return NextResponse.json({ error: "checkins_disabled" }, { status: 403 });
  }

  // Check for existing check-in today (skip for test accounts)
  if (!villager.test_account) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const { data: existing } = await supabase
      .from("check_ins")
      .select("id")
      .eq("villager_id", villager.id)
      .gte("created_at", todayStart)
      .lt("created_at", tomorrowStart)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "already_checked_in" },
        { status: 409 }
      );
    }
  }

  await supabase
    .from("villagers")
    .update({ last_visited_at: new Date().toISOString() })
    .eq("id", villager.id);

  // Exclusive tier eligibility drives which recurring pricing the client shows.
  const isExclusive = await resolveExclusive(supabase, {
    id: villager.id,
    ig_handle: villager.ig_handle,
    roles: villager.roles,
  });

  // Returning supporters with an active recurring pledge shouldn't be asked
  // to pay again at check-in — their visit is already covered by the pledge.
  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("villager_id", villager.id);

  const hasActiveSubscription = (subscriptions ?? []).some((s) =>
    ACTIVE_STATUSES.has(s.status as string)
  );

  const isElder = (villager.roles ?? []).includes(ELDER_ROLE);

  // Decide how this visit is recorded:
  // - elder role      → permanently exempt from payment (paid)
  // - active pledge   → covered by the subscription (paid)
  // - payments off    → nothing owed (skipped)
  // - otherwise       → payment expected, deferred until they complete it (pending)
  let insertMethod: string;
  let insertStatus: string;
  if (isElder) {
    insertMethod = "elder";
    insertStatus = "paid";
  } else if (hasActiveSubscription) {
    insertMethod = "subscription";
    insertStatus = "paid";
  } else if (!paymentsEnabled) {
    insertMethod = "skipped";
    insertStatus = "skipped";
  } else {
    insertMethod = "deferred";
    insertStatus = "pending";
  }

  // Create check-in record
  const { data: checkIn, error: insertErr } = await supabase
    .from("check_ins")
    .insert({
      villager_id: villager.id,
      intent_amount,
      payment_method: insertMethod,
      status: insertStatus,
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      check_in: checkIn,
      has_active_subscription: hasActiveSubscription,
      is_exclusive: isExclusive,
      is_elder: isElder,
    },
    { status: 201 }
  );
}
