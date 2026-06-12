import Stripe from "stripe";
import type { createServerClient } from "@/lib/supabase/server";

type SupabaseClient = ReturnType<typeof createServerClient>;

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(key, {
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return _stripe;
}

let _supporterProductId: string | null = null;

// Recurring subscription items require an existing Stripe Product (inline
// product_data is not allowed on subscription price_data). Prefer the
// STRIPE_SUPPORTER_PRODUCT_ID env var; otherwise create one lazily and cache
// it for the lifetime of the process.
export async function getSupporterProductId(stripe: Stripe): Promise<string> {
  const fromEnv = process.env.STRIPE_SUPPORTER_PRODUCT_ID;
  if (fromEnv) return fromEnv;
  if (_supporterProductId) return _supporterProductId;

  const product = await stripe.products.create({
    name: "Village Supporter",
    description: "Recurring support for the Village (pay what you can).",
  });
  _supporterProductId = product.id;
  return product.id;
}

interface CustomerVillager {
  id: string;
  display_name: string;
  email: string | null;
  stripe_customer_id: string | null;
}

// Returns a Stripe customer id valid for the CURRENT Stripe mode (test vs
// live). Customer ids are mode-specific, so a stored id created with a
// different key — or one that has since been deleted — throws `resource_missing`
// on retrieve. In that case we create a fresh customer and persist it, so
// switching environments/keys doesn't wedge the subscription flow.
export async function resolveCustomerId(
  stripe: Stripe,
  supabase: SupabaseClient,
  villager: CustomerVillager,
  deviceId: string
): Promise<string> {
  const existing = villager.stripe_customer_id;
  if (existing) {
    try {
      const customer = await stripe.customers.retrieve(existing);
      if (!("deleted" in customer && customer.deleted)) return existing;
    } catch (err) {
      const code = err instanceof Stripe.errors.StripeError ? err.code : undefined;
      if (code !== "resource_missing") throw err;
    }
  }

  const customer = await stripe.customers.create({
    name: villager.display_name,
    email: villager.email || undefined,
    metadata: { villager_id: villager.id, device_id: deviceId },
  });
  await supabase
    .from("villagers")
    .update({ stripe_customer_id: customer.id })
    .eq("id", villager.id);
  return customer.id;
}
