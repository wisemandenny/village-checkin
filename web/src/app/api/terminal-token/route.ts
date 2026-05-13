import { stripe } from "@/lib/stripe";
import { NextResponse } from "next/server";

export async function POST() {
  const connectionToken = await stripe.terminal.connectionTokens.create();
  return NextResponse.json({ secret: connectionToken.secret });
}
