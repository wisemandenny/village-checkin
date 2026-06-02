import Stripe from "stripe";

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
