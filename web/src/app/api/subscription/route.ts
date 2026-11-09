import { getStripe } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { resolveExclusive } from "@/lib/exclusive-tier";
import { getCardOnFile, type CardSummary } from "@/lib/card-on-file";
import {
  getActiveSubscription,
  getVillagerByDevice,
} from "@/lib/subscription-sync";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

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
  const stripe = getStripe();

  let liveSub: Stripe.Subscription | null = null;
  if (active) {
    try {
      liveSub = await stripe.subscriptions.retrieve(active.stripe_subscription_id, {
        expand: ["default_payment_method"],
      });
    } catch (err) {
      console.error("[subscription] live retrieve failed", active.stripe_subscription_id, err);
    }
  }

  let card: CardSummary | null = null;
  if (villager.stripe_customer_id) {
    try {
      card = await getCardOnFile(stripe, villager.stripe_customer_id, liveSub);
    } catch (err) {
      console.error("[subscription] card lookup failed", villager.stripe_customer_id, err);
    }
  }

  // An ended exclusive pledge restarts when the card is updated (non-exclusive tiers can't subscribe).
  let canResubscribe = false;
  if (!active && isExclusive && villager.stripe_customer_id) {
    const { count } = await supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("villager_id", villager.id);
    canResubscribe = (count ?? 0) > 0;
  }

  const base = {
    is_exclusive: isExclusive,
    can_update_payment_method: Boolean(villager.stripe_customer_id),
    can_resubscribe: canResubscribe,
    card,
  };

  if (!active) {
    return NextResponse.json({ ...base, subscription: null });
  }

  return NextResponse.json({
    ...base,
    subscription: {
      stripe_subscription_id: active.stripe_subscription_id,
      amount: active.amount,
      interval: active.interval,
      status: active.status,
      cancel_at_period_end: liveSub?.cancel_at_period_end ?? false,
      // In this Stripe API version the billing period lives on the item, not the subscription object.
      current_period_end: liveSub?.items.data[0]?.current_period_end ?? null,
    },
  });
}
