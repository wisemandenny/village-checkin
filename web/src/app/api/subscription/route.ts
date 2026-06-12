import { getStripe } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { resolveExclusive } from "@/lib/exclusive-tier";
import {
  getActiveSubscription,
  getVillagerByDevice,
} from "@/lib/subscription-sync";
import { NextRequest, NextResponse } from "next/server";

// Returns the villager's current recurring pledge (if any) plus their tier, so
// the manage UI can render amount/interval, the next billing date, and which
// actions are available. Reads the live Stripe subscription for fields not
// mirrored locally (cancel_at_period_end and the current period end).
export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("device_id");
  if (!deviceId) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  const villager = await getVillagerByDevice(supabase, deviceId);
  if (!villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  const isExclusive = await resolveExclusive(supabase, {
    id: villager.id,
    ig_handle: villager.ig_handle,
    roles: villager.roles,
  });

  const active = await getActiveSubscription(supabase, villager.id);
  if (!active) {
    return NextResponse.json({ subscription: null, is_exclusive: isExclusive });
  }

  let cancelAtPeriodEnd = false;
  let currentPeriodEnd: number | null = null;
  try {
    const sub = await getStripe().subscriptions.retrieve(
      active.stripe_subscription_id
    );
    cancelAtPeriodEnd = sub.cancel_at_period_end;
    // In this Stripe API version the billing period lives on the item, not the
    // subscription object.
    currentPeriodEnd = sub.items.data[0]?.current_period_end ?? null;
  } catch (err) {
    console.error("[subscription] live retrieve failed", active.stripe_subscription_id, err);
  }

  return NextResponse.json({
    is_exclusive: isExclusive,
    subscription: {
      stripe_subscription_id: active.stripe_subscription_id,
      amount: active.amount,
      interval: active.interval,
      status: active.status,
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_end: currentPeriodEnd,
    },
  });
}
