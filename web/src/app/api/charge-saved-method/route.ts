import { getStripe } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { recordContribution } from "@/lib/contributions";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { amount, check_in_id, device_id, payment_method_id } = body;

  if (!amount || !check_in_id || !device_id || !payment_method_id) {
    return NextResponse.json(
      { error: "amount, check_in_id, device_id, and payment_method_id are required" },
      { status: 400 }
    );
  }

  if (amount < 50) {
    return NextResponse.json(
      { error: "Minimum amount is $0.50 (50 cents)" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();
  const { data: villager } = await supabase
    .from("villagers")
    .select("id, stripe_customer_id")
    .contains("device_ids", [device_id])
    .single();

  if (!villager?.stripe_customer_id) {
    return NextResponse.json({ error: "No saved payment methods" }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const chargedAmount = Math.ceil((amount + 30) / (1 - 0.029));

    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargedAmount,
      currency: "cad",
      customer: villager.stripe_customer_id,
      payment_method: payment_method_id,
      off_session: true,
      confirm: true,
      metadata: { check_in_id },
    });

    if (paymentIntent.status === "succeeded") {
      await supabase
        .from("check_ins")
        .update({
          intent_amount: amount,
          payment_method: "online_fallback",
          status: "paid",
          stripe_transaction_id: paymentIntent.id,
        })
        .eq("id", check_in_id);

      // Webhook will also record this; unique stripe/check_in keys make it safe.
      await recordContribution(supabase, {
        villagerId: villager.id,
        amountCents: amount,
        source: "check_in",
        checkInId: check_in_id,
        stripeTransactionId: paymentIntent.id,
      });
    }

    return NextResponse.json({ status: paymentIntent.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
