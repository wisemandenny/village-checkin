import { getStripe } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const checkInId = session.metadata?.check_in_id;

    if (checkInId) {
      const supabase = createServerClient();
      await supabase
        .from("check_ins")
        .update({
          status: "paid",
          stripe_transaction_id: session.payment_intent as string,
        })
        .eq("id", checkInId);
    }
  }

  return NextResponse.json({ received: true });
}
