import { getStripe, getSupporterProductId, resolveCustomerId } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { resolveExclusive } from "@/lib/exclusive-tier";
import { exclusiveMonthlyTotalCents } from "@/lib/fees";
import { firstMondayOfNextMonth, toUnixSeconds } from "@/lib/first-monday";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

// Creates the exclusive recurring support subscription via Stripe (the only
// recurring tier). Returns the client_secret used to confirm the first payment
// inline with Stripe Elements (and save the card for future cycles).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, check_in_id } = body as {
    device_id?: string;
    check_in_id?: string;
  };

  if (!device_id) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const supabase = createServerClient();

    const { data: villager } = await supabase
      .from("villagers")
      .select("id, stripe_customer_id, display_name, email, roles, ig_handle")
      .eq("device_id", device_id)
      .single();

    if (!villager) {
      return NextResponse.json({ error: "Villager not found" }, { status: 404 });
    }

    // Recurring support is the exclusive tier only; everyone else uses the
    // one-time flow.
    const isExclusive = await resolveExclusive(supabase, {
      id: villager.id,
      ig_handle: villager.ig_handle,
      roles: villager.roles,
    });

    if (!isExclusive) {
      return NextResponse.json(
        { error: "Recurring support is for exclusive members only" },
        { status: 403 }
      );
    }

    // Pricing is fixed and enforced server-side: $10/month support base plus
    // the processing fee.
    const chargeAmount = exclusiveMonthlyTotalCents();

    const customerId = await resolveCustomerId(stripe, supabase, villager, device_id);

    const productId = await getSupporterProductId(stripe);

    // New supporters pay in full immediately (the inline Stripe Elements flow
    // below confirms this first invoice). The recurring cycle is then re-anchored
    // to the first Monday of next month: we stash that anchor here and the
    // `invoice.paid` webhook wraps the subscription in a tagged Subscription
    // Schedule (same mechanism as the migration), which the extend cron keeps
    // pinned to each shifting first Monday thereafter. Doing the re-anchor after
    // payment (rather than via `billing_cycle_anchor` at creation) keeps the
    // immediate charge intact — a future anchor with no proration would suppress
    // the first invoice entirely and leave nothing to confirm.
    const anchorUnix = toUnixSeconds(firstMondayOfNextMonth());

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [
        {
          price_data: {
            currency: "cad",
            product: productId,
            unit_amount: chargeAmount,
            recurring: { interval: "month" },
          },
        },
      ],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.confirmation_secret"],
      metadata: {
        villager_id: villager.id,
        device_id,
        // Read back by the webhook to pin the schedule's first-Monday phase to
        // the exact anchor computed here (rather than recomputing later).
        first_monday_anchor: String(anchorUnix),
        first_monday_pending: "true",
        ...(check_in_id ? { check_in_id } : {}),
      },
    });

    const invoice = subscription.latest_invoice as Stripe.Invoice | null;
    const clientSecret = invoice?.confirmation_secret?.client_secret;

    if (!clientSecret) {
      return NextResponse.json(
        { error: "Could not initialize subscription payment" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      client_secret: clientSecret,
      subscription_id: subscription.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Subscription creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
