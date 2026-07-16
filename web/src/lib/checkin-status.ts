import type { CheckInStatus } from "@/lib/types";

/** Statuses that mean nothing is owed for the visit. */
export function isPaymentSettled(status: string | null | undefined): boolean {
  return status === "paid" || status === "waived";
}

/**
 * Normalize admin create/update fields so a $0 "paid" visit becomes waived,
 * and a waived visit always carries a zero amount.
 */
export function normalizeAdminCheckInFields(fields: {
  status?: CheckInStatus | string;
  intent_amount?: number;
}): {
  status?: CheckInStatus | string;
  intent_amount?: number;
} {
  const out = { ...fields };

  if (out.status === "waived") {
    out.intent_amount = 0;
    return out;
  }

  if (
    out.status === "paid" &&
    typeof out.intent_amount === "number" &&
    out.intent_amount === 0
  ) {
    out.status = "waived";
  }

  return out;
}
