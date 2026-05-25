import { getStripe } from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { amount, check_in_id } = body;

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
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { check_in_id },
    });

    return NextResponse.json({ client_secret: paymentIntent.client_secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment intent creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
