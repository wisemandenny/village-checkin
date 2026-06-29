import { getStripe, resolveCustomerId } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { resolveExclusive } from "@/lib/exclusive-tier";
import { exclusiveMonthlyTotalCents } from "@/lib/fees";
import { firstOfNextMonth, toUnixSeconds } from "@/lib/billing-anchor";
import { NextRequest, NextResponse } from "next/server";

// Starts the exclusive recurring support pledge (the only recurring tier).
//
// Billing model: everyone is billed on the FIRST DAY of the month. A new
// supporter pays the full amount immediately here (a standalone PaymentIntent,
// confirmed inline with Stripe Elements, which also saves the card). Once that
// payment succeeds, the `payment_intent.succeeded` webhook creates the actual
// subscription anchored to the first of next month — so the next charge lands on
// the 1st and every month after that, natively (no schedules, no cron).
//
// We charge first and create the subscription afterward because a subscription
// whose first invoice is in the future produces no immediate invoice to confirm,
// which would break the inline payment.
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

    // The first recurring charge lands on the first of next month. The webhook
    // reads this back rather than recomputing, so the anchor can't drift if the
    // payment confirms across a month boundary.
    const anchorUnix = toUnixSeconds(firstOfNextMonth());

    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeAmount,
      currency: "cad",
      customer: customerId,
      // Save the card so the webhook-created subscription can charge it on the 1st.
      setup_future_usage: "off_session",
      automatic_payment_methods: { enabled: true },
      metadata: {
        villager_id: villager.id,
        device_id,
        // Drives subscription creation in the `payment_intent.succeeded` webhook.
        subscription_signup: "true",
        recurring_amount: String(chargeAmount),
        first_of_month_anchor: String(anchorUnix),
        ...(check_in_id ? { check_in_id } : {}),
      },
    });

    if (!paymentIntent.client_secret) {
      return NextResponse.json(
        { error: "Could not initialize subscription payment" },
        { status: 500 }
      );
    }

    return NextResponse.json({ client_secret: paymentIntent.client_secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Subscription creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
