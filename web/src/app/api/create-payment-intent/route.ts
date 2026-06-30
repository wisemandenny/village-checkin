import { getStripe } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { amount, check_in_id, device_id } = body;

  if (!amount || !check_in_id) {
    return NextResponse.json(
      { error: "amount and check_in_id are required" },
      { status: 400 }
    );
  }

  if (amount < 50) {
    return NextResponse.json(
      { error: "Minimum amount is $0.50 (50 cents)" },
      { status: 400 }
    );
  }

  try {
    const stripe = getStripe();
    let customerId: string | undefined;

    if (device_id) {
      const supabase = createServerClient();
      const { data: villager } = await supabase
        .from("villagers")
        .select("id, stripe_customer_id, display_name, email")
        .contains("device_ids", [device_id])
        .single();

      if (villager) {
        if (villager.stripe_customer_id) {
          customerId = villager.stripe_customer_id;
        } else {
          const customer = await stripe.customers.create({
            name: villager.display_name,
            email: villager.email || undefined,
            metadata: { villager_id: villager.id, device_id },
          });
          customerId = customer.id;

          await supabase
            .from("villagers")
            .update({ stripe_customer_id: customer.id })
            .eq("id", villager.id);
        }
      }
    }

    const chargedAmount = Math.ceil((amount + 30) / (1 - 0.029));

    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargedAmount,
      currency: "cad",
      automatic_payment_methods: { enabled: true },
      metadata: { check_in_id },
      ...(customerId && {
        customer: customerId,
        setup_future_usage: "on_session",
      }),
    });

    return NextResponse.json({ client_secret: paymentIntent.client_secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment intent creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
