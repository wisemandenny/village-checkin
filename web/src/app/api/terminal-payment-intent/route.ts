import { stripe } from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { amount } = await req.json();

  if (!amount || amount < 50) {
    return NextResponse.json(
      { error: "amount must be at least 50 cents" },
      { status: 400 }
    );
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: "usd",
    payment_method_types: ["card_present"],
    capture_method: "automatic",
  });

  return NextResponse.json({ client_secret: paymentIntent.client_secret });
}
