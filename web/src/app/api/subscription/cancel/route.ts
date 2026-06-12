import { getStripe } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import {
  getActiveSubscription,
  getVillagerByDevice,
} from "@/lib/subscription-sync";
import { NextRequest, NextResponse } from "next/server";

// Cancels a villager's recurring pledge at the end of the current billing
// period (they keep what they've already paid for). Stripe emits
// customer.subscription.updated now and customer.subscription.deleted when the
// period ends; both are handled by the existing webhook.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id } = body as { device_id?: string };

  if (!device_id) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  const villager = await getVillagerByDevice(supabase, device_id);
  if (!villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }

  const active = await getActiveSubscription(supabase, villager.id);
  if (!active) {
    return NextResponse.json({ error: "No active subscription" }, { status: 404 });
  }

  try {
    await getStripe().subscriptions.update(active.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel subscription";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
