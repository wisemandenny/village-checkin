import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import {
  customerIdOf,
  getActiveSubscription,
  getVillagerByDevice,
} from "@/lib/subscription-sync";
import { NextRequest, NextResponse } from "next/server";

// Old cards are detached so the one-time flow stops offering the replaced card.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id, setup_intent_id, payment_intent_id } = body as {
    device_id?: string;
    setup_intent_id?: string;
    // Set when the card update restarted an ended pledge via the signup charge.
    payment_intent_id?: string;
  };

  if (!device_id || (!setup_intent_id && !payment_intent_id)) {
    return NextResponse.json(
      { error: "device_id and setup_intent_id or payment_intent_id are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const villager = await getVillagerByDevice(supabase, device_id);
  if (!villager?.stripe_customer_id) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }
  const customerId = villager.stripe_customer_id;

  const stripe = getStripe();

  let intent: Stripe.SetupIntent | Stripe.PaymentIntent;
  try {
    intent = payment_intent_id
      ? await stripe.paymentIntents.retrieve(payment_intent_id)
      : await stripe.setupIntents.retrieve(setup_intent_id!);
  } catch {
    return NextResponse.json({ error: "Card update not found" }, { status: 404 });
  }

  // The intent id comes from the client, so it must belong to this villager.
  if (customerIdOf(intent.customer) !== customerId) {
    return NextResponse.json({ error: "Card update not found" }, { status: 404 });
  }
  if (intent.status !== "succeeded") {
    return NextResponse.json({ error: "Card was not confirmed" }, { status: 400 });
  }
  const resubscribed = payment_intent_id
    ? (intent as Stripe.PaymentIntent).metadata?.subscription_signup === "true"
    : false;
  if (payment_intent_id && !resubscribed) {
    return NextResponse.json({ error: "Card update not found" }, { status: 404 });
  }

  const paymentMethodId =
    typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (!paymentMethodId) {
    return NextResponse.json({ error: "Card was not confirmed" }, { status: 400 });
  }

  let paymentRetried = false;
  let paymentRetryFailed = false;

  try {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const active = await getActiveSubscription(supabase, villager.id);
    if (active) {
      const sub = await stripe.subscriptions.update(active.stripe_subscription_id, {
        default_payment_method: paymentMethodId,
        expand: ["latest_invoice"],
      });

      // Settle now rather than waiting for Stripe's next automatic retry.
      const invoice = sub.latest_invoice as Stripe.Invoice | null;
      if (sub.status === "past_due" && invoice?.id && invoice.status === "open") {
        paymentRetried = true;
        try {
          await stripe.invoices.pay(invoice.id, { payment_method: paymentMethodId });
        } catch (err) {
          paymentRetryFailed = true;
          console.error("[payment-method] past-due invoice retry failed", invoice.id, err);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update card";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Best-effort: the new card is already the default, so a failed detach only leaves a stale card listed.
  try {
    const cards = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 100 });
    for (const card of cards.data) {
      if (card.id !== paymentMethodId) await stripe.paymentMethods.detach(card.id);
    }
  } catch (err) {
    console.error("[payment-method] detaching old cards failed", customerId, err);
  }

  return NextResponse.json({
    ok: true,
    resubscribed,
    payment_retried: paymentRetried,
    payment_retry_failed: paymentRetryFailed,
  });
}
