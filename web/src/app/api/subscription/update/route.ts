import { getStripe, getSupporterProductId } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { resolveExclusive } from "@/lib/exclusive-tier";
import {
  getActiveSubscription,
  getVillagerByDevice,
} from "@/lib/subscription-sync";
import { NextRequest, NextResponse } from "next/server";

const EXCLUSIVE_MIN_CENTS = 1000; // $10/month, editable up

// Changes the amount of an existing recurring pledge. Only the exclusive tier
// can edit its amount (standard is fixed at $5/week). The new amount applies
// from the next cycle (no proration). The customer.subscription.updated webhook
// mirrors the change into the local table and reconciles Kit tags.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, amount } = body as { device_id?: string; amount?: number };

  if (!device_id) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }
  if (!amount || !Number.isInteger(amount) || amount < 50) {
    return NextResponse.json(
      { error: "Amount must be a whole number of cents, minimum 50" },
      { status: 400 }
    );
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

  const isExclusive = await resolveExclusive(supabase, {
    id: villager.id,
    ig_handle: villager.ig_handle,
    roles: villager.roles,
  });

  if (!isExclusive) {
    return NextResponse.json(
      { error: "Your support amount is fixed at $5/week" },
      { status: 400 }
    );
  }
  if (amount < EXCLUSIVE_MIN_CENTS) {
    return NextResponse.json(
      { error: "Exclusive tier minimum is $10/month" },
      { status: 400 }
    );
  }

  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(active.stripe_subscription_id);
    const itemId = sub.items.data[0]?.id;
    if (!itemId) {
      return NextResponse.json({ error: "Subscription has no billable item" }, { status: 500 });
    }

    const productId = await getSupporterProductId(stripe);

    await stripe.subscriptions.update(active.stripe_subscription_id, {
      items: [
        {
          id: itemId,
          price_data: {
            currency: "cad",
            product: productId,
            unit_amount: amount,
            recurring: { interval: active.interval },
          },
        },
      ],
      proration_behavior: "none",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update subscription";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
