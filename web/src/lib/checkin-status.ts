import type { CheckInStatus, PaymentMethod } from "@/lib/types";

/** Statuses that mean nothing is owed for the visit. */
export function isPaymentSettled(status: string | null | undefined): boolean {
  return status === "paid" || status === "waived";
}

/** Payment methods settled up front, so a $0 amount at the desk is expected. */
const PREPAID_METHODS = new Set<string>(["subscription", "elder"]);

/**
 * Normalize admin create/update fields: a waived visit always carries a zero
 * amount, and a $0 "paid" visit becomes waived unless the payment method is
 * prepaid (a subscriber owes nothing at the desk but is still a paid visit).
 */
export function normalizeAdminCheckInFields(fields: {
  status?: CheckInStatus | string;
  intent_amount?: number;
  payment_method?: PaymentMethod | string;
}): {
  status?: CheckInStatus | string;
  intent_amount?: number;
  payment_method?: PaymentMethod | string;
} {
  const out = { ...fields };

  if (out.status === "waived") {
    out.intent_amount = 0;
    return out;
  }

  if (
    out.status === "paid" &&
    out.intent_amount === 0 &&
    !PREPAID_METHODS.has(out.payment_method ?? "")
  ) {
    out.status = "waived";
  }

  return out;
}
