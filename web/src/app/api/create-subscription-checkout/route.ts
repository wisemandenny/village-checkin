import { getStripe } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { findVillagerByEmail } from "@/lib/subscription-sync";
import { NextRequest, NextResponse } from "next/server";

const VALID_INTERVALS = ["week", "month"] as const;
type Interval = (typeof VALID_INTERVALS)[number];

// Hosted Stripe Checkout (subscription mode) for the newsletter link flow,
// where the visitor arrives from email with no device/app session. The
// resulting subscription is reconciled to a villager by the Stripe webhook.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, amount, interval } = body as {
    email?: string;
    amount?: number;
    interval?: Interval;
  };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
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

  const stripe = getStripe();
  const supabase = createServerClient();
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;

  // Case-insensitive exact match against an existing villager, if any.
  const villager = await findVillagerByEmail<{ id: string; stripe_customer_id: string | null }>(
    supabase,
    email,
    "id, stripe_customer_id"
  );

  const metadata: Record<string, string> = { email };
  if (villager?.id) metadata.villager_id = villager.id;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "cad",
          product_data: { name: "Village Supporter" },
          unit_amount: amount,
          recurring: { interval },
        },
        quantity: 1,
      },
    ],
    ...(villager?.stripe_customer_id
      ? { customer: villager.stripe_customer_id }
      : { customer_email: email }),
    subscription_data: { metadata },
    metadata,
    success_url: `${baseUrl}/support/success`,
    cancel_url: `${baseUrl}/support`,
  });

  return NextResponse.json({ url: session.url });
}
