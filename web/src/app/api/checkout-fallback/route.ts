import { stripe } from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { check_in_id, amount } = body;

  if (!check_in_id || !amount) {
    return NextResponse.json(
      { error: "check_in_id and amount are required" },
      { status: 400 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "Studio Session — Pay What You Can" },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    metadata: { check_in_id },
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/`,
  });

  return NextResponse.json({ url: session.url });
}
