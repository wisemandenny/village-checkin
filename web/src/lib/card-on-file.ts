import type Stripe from "stripe";

export interface CardSummary {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  expired: boolean;
}

export function isCardExpired(expMonth: number, expYear: number, now = new Date()): boolean {
  const year = now.getFullYear();
  return expYear < year || (expYear === year && expMonth < now.getMonth() + 1);
}

function toCardSummary(pm: Stripe.PaymentMethod | string | null | undefined): CardSummary | null {
  if (!pm || typeof pm === "string" || !pm.card) return null;
  const { brand, last4, exp_month, exp_year } = pm.card;
  return { brand, last4, exp_month, exp_year, expired: isCardExpired(exp_month, exp_year) };
}

// Mirrors Stripe's precedence for which card the next recurring charge uses.
export async function getCardOnFile(
  stripe: Stripe,
  customerId: string,
  subscription: Stripe.Subscription | null
): Promise<CardSummary | null> {
  const fromSub = toCardSummary(subscription?.default_payment_method as Stripe.PaymentMethod | null);
  if (fromSub) return fromSub;

  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (!("deleted" in customer && customer.deleted)) {
    const fromCustomer = toCardSummary(
      (customer as Stripe.Customer).invoice_settings?.default_payment_method
    );
    if (fromCustomer) return fromCustomer;
  }

  const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
  return toCardSummary(methods.data[0]);
}
