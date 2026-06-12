import { getStripe, getSupporterProductId, resolveCustomerId } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { resolveExclusive } from "@/lib/exclusive-tier";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

const EXCLUSIVE_MIN_CENTS = 1000; // $10/month, editable up
const STANDARD_WEEKLY_CENTS = 500; // $5/week, fixed

const VALID_INTERVALS = ["week", "month"] as const;
type Interval = (typeof VALID_INTERVALS)[number];

// Creates a recurring "pay what you can" support subscription via Stripe.
// Returns the client_secret used to confirm the first payment inline with
// Stripe Elements (and save the card for future cycles).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { amount, interval, device_id, check_in_id } = body as {
    amount?: number;
    interval?: Interval;
    device_id?: string;
    check_in_id?: string;
  };

  if (!device_id) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }
  if (!amount || !Number.isInteger(amount) || amount < 50) {
    return NextResponse.json(
      { error: "Amount must be a whole number of cents, minimum 50" },
      { status: 400 }
    );
  }
  if (!interval || !VALID_INTERVALS.includes(interval)) {
    return NextResponse.json(
      { error: "interval must be 'week' or 'month'" },
      { status: 400 }
    );
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

    // Enforce tier pricing server-side: exclusive villagers pledge monthly
    // ($10 minimum, editable up); everyone else gets a fixed $5/week.
    const isExclusive = await resolveExclusive(supabase, {
      id: villager.id,
      ig_handle: villager.ig_handle,
      roles: villager.roles,
    });

    if (isExclusive) {
      if (interval !== "month") {
        return NextResponse.json({ error: "Exclusive tier is billed monthly" }, { status: 400 });
      }
      if (amount < EXCLUSIVE_MIN_CENTS) {
        return NextResponse.json({ error: "Exclusive tier minimum is $10/month" }, { status: 400 });
      }
    } else {
      if (interval !== "week" || amount !== STANDARD_WEEKLY_CENTS) {
        return NextResponse.json({ error: "Recurring support is $5/week" }, { status: 400 });
      }
    }

    const customerId = await resolveCustomerId(stripe, supabase, villager, device_id);

    const productId = await getSupporterProductId(stripe);

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [
        {
          price_data: {
            currency: "cad",
            product: productId,
            unit_amount: amount,
            recurring: { interval },
          },
        },
      ],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.confirmation_secret"],
      metadata: {
        villager_id: villager.id,
        device_id,
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
