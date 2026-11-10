import { getStripe } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { getVillagerByDevice } from "@/lib/subscription-sync";
import { NextRequest, NextResponse } from "next/server";

// Not gated on subscription state so expired, past-due, or cancelling villagers can still fix their card.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { device_id } = body as { device_id?: string };

  if (!device_id) {
    return NextResponse.json({ error: "device_id is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  const villager = await getVillagerByDevice(supabase, device_id);
  if (!villager) {
    return NextResponse.json({ error: "Villager not found" }, { status: 404 });
  }
  if (!villager.stripe_customer_id) {
    return NextResponse.json({ error: "No payment method on file" }, { status: 404 });
  }

  try {
    const setupIntent = await getStripe().setupIntents.create({
      customer: villager.stripe_customer_id,
      usage: "off_session",
      // Excluding Link stops it from autofilling the card being replaced.
      payment_method_types: ["card"],
      metadata: { villager_id: villager.id, purpose: "payment_method_update" },
    });

    if (!setupIntent.client_secret) {
      return NextResponse.json({ error: "Could not start card update" }, { status: 500 });
    }

    return NextResponse.json({ client_secret: setupIntent.client_secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start card update";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
