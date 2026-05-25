import { getStripe } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("device_id");

  if (!deviceId) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: villager } = await supabase
    .from("villagers")
    .select("stripe_customer_id")
    .eq("device_id", deviceId)
    .single();

  if (!villager?.stripe_customer_id) {
    return NextResponse.json({ methods: [] });
  }

  try {
    const stripe = getStripe();
    const methods = await stripe.paymentMethods.list({
      customer: villager.stripe_customer_id,
      type: "card",
    });

    const cards = methods.data.map((m) => ({
      id: m.id,
      brand: m.card?.brand ?? "unknown",
      last4: m.card?.last4 ?? "****",
      exp_month: m.card?.exp_month,
      exp_year: m.card?.exp_year,
    }));

    return NextResponse.json({ methods: cards });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list payment methods";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
