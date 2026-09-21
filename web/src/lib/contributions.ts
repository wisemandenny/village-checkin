import type { createServerClient } from "@/lib/supabase/server";

type SupabaseClient = ReturnType<typeof createServerClient>;

export type ContributionSource =
  | "check_in"
  | "subscription_signup"
  | "subscription_invoice"
  | "admin";

export type RecordContributionInput = {
  villagerId: string;
  amountCents: number;
  source: ContributionSource;
  checkInId?: string | null;
  stripeTransactionId?: string | null;
  createdAt?: string | null;
  /** When true and checkInId is set, refresh amount on conflict (admin edits). */
  replaceExisting?: boolean;
};

/**
 * Insert a contribution row. Unique on check_in_id / stripe_transaction_id
 * makes webhook redeliveries and overlapping paid-paths idempotent (first write
 * wins unless replaceExisting is set).
 */
export async function recordContribution(
  supabase: SupabaseClient,
  input: RecordContributionInput
): Promise<void> {
  if (!input.villagerId || input.amountCents <= 0) return;

  const row: Record<string, unknown> = {
    villager_id: input.villagerId,
    amount_cents: input.amountCents,
    source: input.source,
    check_in_id: input.checkInId ?? null,
    stripe_transaction_id: input.stripeTransactionId ?? null,
  };
  if (input.createdAt) row.created_at = input.createdAt;

  if (input.replaceExisting && input.checkInId) {
    const { error } = await supabase
      .from("contributions")
      .upsert(row, { onConflict: "check_in_id" });
    if (error && error.code !== "23505") {
      console.error("[contributions] upsert failed", error);
    }
    return;
  }

  const { error } = await supabase.from("contributions").insert(row);

  // 23505 = unique_violation (already recorded for this check-in / Stripe txn)
  if (error && error.code !== "23505") {
    console.error("[contributions] insert failed", error);
  }
}
