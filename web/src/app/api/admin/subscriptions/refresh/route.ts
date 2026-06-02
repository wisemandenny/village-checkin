import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { getStripe } from "@/lib/stripe";
import { syncSubscriptionFromStripe } from "@/lib/subscription-sync";

// Pages through all Stripe subscriptions with several Kit calls each.
export const maxDuration = 300;

// Reconciles the local subscriptions table (and Kit tags) from Stripe, to
// recover from any missed webhook deliveries. Stripe is the source of truth.
export async function POST(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const stripe = getStripe();
  const supabase = createServerClient();

  let synced = 0;
  let failed = 0;

  try {
    for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
      try {
        if (await syncSubscriptionFromStripe(supabase, sub)) synced++;
      } catch (err) {
        console.error("[subscriptions] refresh failed for", sub.id, err);
        failed++;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refresh failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ synced, failed });
}
