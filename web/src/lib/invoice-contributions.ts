import type Stripe from "stripe";
import type { createServerClient } from "@/lib/supabase/server";
import { recordContribution } from "@/lib/contributions";
import {
  customerIdOf,
  ensureVillager,
  type VillagerLite,
} from "@/lib/subscription-sync";

type SupabaseClient = ReturnType<typeof createServerClient>;

/** The villager a Stripe invoice belongs to, or null when nothing links it. */
export async function resolveInvoiceVillager(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice
): Promise<VillagerLite | null> {
  const subDetails = invoice.parent?.subscription_details ?? null;
  const meta = subDetails?.metadata ?? {};
  const customerId = customerIdOf(invoice.customer);
  const email = invoice.customer_email ?? meta.email ?? null;

  const villager = await ensureVillager(supabase, {
    villagerId: meta.villager_id,
    customerId,
    email,
  });
  if (villager) return villager;

  // Older pledges may lack villager_id on subscription metadata — fall back to
  // our mirrored subscriptions row.
  const stripeSubId = customerIdOf(subDetails?.subscription);
  if (!stripeSubId) return null;
  const { data: subRow } = await supabase
    .from("subscriptions")
    .select("villager_id")
    .eq("stripe_subscription_id", stripeSubId)
    .maybeSingle();
  if (!subRow?.villager_id) return null;
  return ensureVillager(supabase, { villagerId: subRow.villager_id, customerId, email });
}

/** Ledger entry for a paid invoice; unique on the invoice id so re-runs are no-ops. */
export async function recordInvoiceContribution(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice,
  villager: VillagerLite,
  checkInId: string | null = null
): Promise<void> {
  if (!invoice.id || (invoice.amount_paid ?? 0) <= 0) return;
  await recordContribution(supabase, {
    villagerId: villager.id,
    amountCents: invoice.amount_paid,
    source:
      invoice.billing_reason === "subscription_create"
        ? "subscription_signup"
        : "subscription_invoice",
    checkInId,
    stripeTransactionId: invoice.id,
    createdAt: invoice.status_transitions?.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
      : undefined,
  });
}

/**
 * Walk every paid Stripe invoice and add any the ledger is missing. The
 * ledger only started receiving invoices via webhook when it was created, so
 * this is what gives long-time subscribers their full history.
 */
export async function backfillInvoiceContributions(
  supabase: SupabaseClient,
  stripe: Stripe
): Promise<{ recorded: number; unmatched: number }> {
  const { data: existing } = await supabase
    .from("contributions")
    .select("stripe_transaction_id")
    .not("stripe_transaction_id", "is", null);
  const known = new Set((existing ?? []).map((r) => r.stripe_transaction_id as string));

  let recorded = 0;
  let unmatched = 0;
  for await (const invoice of stripe.invoices.list({ status: "paid", limit: 100 })) {
    if (!invoice.id || known.has(invoice.id) || (invoice.amount_paid ?? 0) <= 0) continue;
    const villager = await resolveInvoiceVillager(supabase, invoice);
    if (!villager) {
      unmatched++;
      continue;
    }
    await recordInvoiceContribution(supabase, invoice, villager);
    recorded++;
  }
  return { recorded, unmatched };
}
