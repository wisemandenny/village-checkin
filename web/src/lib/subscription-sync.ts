import type Stripe from "stripe";
import { createServerClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import {
  addTag,
  createPurchase,
  findSubscriberByEmail,
  getKitTagId,
  isKitConfigured,
  isKitPurchasesConfigured,
  removeTag,
} from "@/lib/kit";
import { getKitAccessToken } from "@/lib/kit-oauth";

type SupabaseClient = ReturnType<typeof createServerClient>;

export interface VillagerLite {
  id: string;
  email: string | null;
  display_name: string;
  stripe_customer_id: string | null;
  kit_subscriber_id: string | null;
}

const VILLAGER_COLUMNS =
  "id, email, display_name, stripe_customer_id, kit_subscriber_id";
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

// Escapes PostgREST/LIKE metacharacters so a user-supplied email is matched
// literally (case-insensitively) rather than as a wildcard pattern.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Case-insensitive exact email lookup that tolerates duplicate rows (email is
// not unique) instead of throwing like .maybeSingle() would.
export async function findVillagerByEmail<T = VillagerLite>(
  supabase: SupabaseClient,
  email: string,
  columns: string = VILLAGER_COLUMNS
): Promise<T | null> {
  const { data, error } = await supabase
    .from("villagers")
    .select(columns)
    .ilike("email", escapeLike(email))
    .limit(1);
  if (error) {
    console.error("[villagers] findVillagerByEmail failed", error);
    return null;
  }
  return (data?.[0] as T) ?? null;
}

export function customerIdOf(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "id" in (value as Record<string, unknown>)) {
    return (value as { id: string }).id;
  }
  return null;
}

async function findVillager(
  supabase: SupabaseClient,
  opts: { villagerId?: string | null; customerId?: string | null; email?: string | null }
): Promise<VillagerLite | null> {
  if (opts.villagerId) {
    const { data } = await supabase.from("villagers").select(VILLAGER_COLUMNS).eq("id", opts.villagerId).maybeSingle();
    if (data) return data as VillagerLite;
  }
  if (opts.customerId) {
    const { data } = await supabase.from("villagers").select(VILLAGER_COLUMNS).eq("stripe_customer_id", opts.customerId).maybeSingle();
    if (data) return data as VillagerLite;
  }
  if (opts.email) {
    const found = await findVillagerByEmail<VillagerLite>(supabase, opts.email);
    if (found) return found;
  }
  return null;
}

// Finds a villager or creates a minimal one (used by the newsletter link flow,
// where a supporter may not exist in the app yet). Backfills stripe_customer_id.
export async function ensureVillager(
  supabase: SupabaseClient,
  opts: { villagerId?: string | null; customerId?: string | null; email?: string | null; name?: string | null }
): Promise<VillagerLite | null> {
  const existing = await findVillager(supabase, opts);
  if (existing) {
    if (opts.customerId && !existing.stripe_customer_id) {
      const { error } = await supabase
        .from("villagers")
        .update({ stripe_customer_id: opts.customerId })
        .eq("id", existing.id);
      if (error) console.error("[villagers] stripe_customer_id backfill failed", error);
      else existing.stripe_customer_id = opts.customerId;
    }
    return existing;
  }

  if (!opts.email) return null;

  const baseName = (opts.name || opts.email.split("@")[0] || "Supporter").trim();
  for (let attempt = 0; attempt < 3; attempt++) {
    const displayName = attempt === 0 ? baseName : `${baseName} ${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase
      .from("villagers")
      .insert({
        device_id: `web-${crypto.randomUUID()}`,
        display_name: displayName,
        email: opts.email,
        marketing_opt_in: true,
        stripe_customer_id: opts.customerId ?? null,
      })
      .select(VILLAGER_COLUMNS)
      .single();
    if (!error && data) return data as VillagerLite;
    if (error?.code !== "23505") {
      console.error("[villagers] ensureVillager insert failed", error);
      break; // only retry on display_name uniqueness
    }
  }
  return null;
}

// Reconciles a villager's Kit tier tags from their CURRENT active
// subscriptions in the DB (order-independent). A weekly tag is present iff the
// villager has an active weekly subscription, likewise monthly. This avoids
// per-event add/remove races (e.g. cancelling an old pledge stripping a tag the
// new pledge still needs).
export async function reconcileSupporterTags(
  supabase: SupabaseClient,
  villager: VillagerLite
): Promise<void> {
  if (!isKitConfigured() || !villager.email) return;

  const { data, error } = await supabase
    .from("subscriptions")
    .select("interval, status")
    .eq("villager_id", villager.id);
  if (error) {
    console.error("[kit] reconcileSupporterTags read failed", error);
    return;
  }

  const activeIntervals = new Set(
    (data ?? [])
      .filter((s) => ACTIVE_STATUSES.has(s.status as string))
      .map((s) => s.interval as string)
  );

  let subscriberId = villager.kit_subscriber_id ? Number(villager.kit_subscriber_id) : null;

  try {
    for (const intervalKey of ["week", "month"] as const) {
      const tagId = getKitTagId(intervalKey);
      if (!tagId) continue;
      if (activeIntervals.has(intervalKey)) {
        await addTag(tagId, villager.email);
      } else {
        if (!subscriberId) {
          const sub = await findSubscriberByEmail(villager.email);
          subscriberId = sub?.id ?? null;
        }
        if (subscriberId) await removeTag(tagId, subscriberId);
      }
    }
  } catch (err) {
    console.error("[kit] reconcileSupporterTags failed", err);
  }
}

export async function recordKitPurchase(
  email: string | null,
  input: { transactionId: string; amountCents: number; currency: string; productName: string; productId: string }
): Promise<void> {
  // TEMP DIAGNOSTIC: record outcome to studio_settings so prod failures are
  // observable without log access. Remove once purchase sync is confirmed.
  const debug: Record<string, unknown> = {
    at: new Date().toISOString(),
    email,
    txn: input.transactionId,
    amountCents: input.amountCents,
    kitConfigured: isKitConfigured(),
    purchasesConfigured: isKitPurchasesConfigured(),
    result: "unset",
    error: null,
  };
  try {
    debug.tokenPresent = Boolean(await getKitAccessToken());
  } catch (err) {
    debug.tokenPresent = false;
    debug.error = err instanceof Error ? err.message : String(err);
  }

  // Purchases use OAuth (not the API key), so gate on OAuth configuration.
  if (!isKitPurchasesConfigured() || !email || input.amountCents <= 0) {
    debug.result = "skipped:guard";
  } else {
    try {
      await createPurchase({ email, ...input });
      debug.result = "createPurchase:returned";
    } catch (err) {
      debug.result = "createPurchase:threw";
      debug.error = err instanceof Error ? err.message : String(err);
      console.error("[kit] recordKitPurchase failed", err);
    }
  }

  try {
    const supabase = createServerClient();
    await supabase
      .from("studio_settings")
      .upsert(
        { key: "kit_last_purchase_debug", value: debug },
        { onConflict: "key" }
      );
  } catch {
    // best-effort diagnostic only
  }
}

// Enforces a single active pledge per villager: cancels the customer's other
// active subscriptions, keeping `keepId`. Runs only once the kept subscription
// is itself active, so an existing pledge is never dropped before the new one
// is actually paid.
async function cancelOtherActiveSubscriptions(
  supabase: SupabaseClient,
  customerId: string,
  keepId: string
): Promise<void> {
  const stripe = getStripe();
  try {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    for (const other of subs.data) {
      if (other.id === keepId) continue;
      if (ACTIVE_STATUSES.has(other.status)) {
        await stripe.subscriptions.cancel(other.id);
        // Reflect immediately so the tag reconcile sees the final state (the
        // matching subscription.deleted webhook will also arrive).
        await supabase
          .from("subscriptions")
          .update({ status: "canceled", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", other.id);
      }
    }
  } catch (err) {
    console.error("[subscriptions] cancelOtherActiveSubscriptions failed", customerId, err);
  }
}

// Reconciles a single Stripe subscription into the local table + Kit tags.
// Used by the webhook (create/update) and the admin "Refresh from Stripe" job.
export async function syncSubscriptionFromStripe(
  supabase: SupabaseClient,
  sub: Stripe.Subscription
): Promise<boolean> {
  const customerId = customerIdOf(sub.customer);
  const meta = sub.metadata ?? {};
  const price = sub.items.data[0]?.price;
  const amount = price?.unit_amount ?? 0;
  const interval = price?.recurring?.interval;

  const villager = await ensureVillager(supabase, {
    villagerId: meta.villager_id,
    customerId,
    email: meta.email,
  });
  if (!villager) return false;

  const canceled = sub.status === "canceled" || sub.status === "incomplete_expired";

  if (interval !== "week" && interval !== "month") {
    return false;
  }

  const { error } = await supabase.from("subscriptions").upsert(
    {
      villager_id: villager.id,
      stripe_subscription_id: sub.id,
      status: sub.status,
      amount,
      interval,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" }
  );
  if (error) {
    // Don't let Kit tags diverge from a subscriptions table we failed to write.
    console.error("[subscriptions] upsert failed", sub.id, error);
    return false;
  }

  const active = !canceled && ACTIVE_STATUSES.has(sub.status);

  // Once this pledge is active, retire any older active pledge for the same
  // customer so a villager has a single active subscription. Cancel first so
  // the tag reconcile below reflects the final state.
  if (active && customerId) {
    await cancelOtherActiveSubscriptions(supabase, customerId, sub.id);
  }

  await reconcileSupporterTags(supabase, villager);
  return true;
}

// Villager row shape needed to manage a subscription (ownership + tier).
export interface ManageVillagerRow {
  id: string;
  stripe_customer_id: string | null;
  ig_handle: string | null;
  roles: string[] | null;
}

// Active subscription row mirrored from Stripe.
export interface ActiveSubscriptionRow {
  stripe_subscription_id: string;
  amount: number;
  interval: "week" | "month";
  status: string;
}

// Resolves a villager from their device_id (the app's bearer identity) with the
// fields needed to authorize and price a subscription change.
export async function getVillagerByDevice(
  supabase: SupabaseClient,
  deviceId: string
): Promise<ManageVillagerRow | null> {
  const { data } = await supabase
    .from("villagers")
    .select("id, stripe_customer_id, ig_handle, roles")
    .eq("device_id", deviceId)
    .maybeSingle();
  return (data as ManageVillagerRow) ?? null;
}

// Returns the villager's current active (or past_due/trialing) subscription, if
// any. A villager has at most one active pledge (enforced on creation).
export async function getActiveSubscription(
  supabase: SupabaseClient,
  villagerId: string
): Promise<ActiveSubscriptionRow | null> {
  const { data } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id, amount, interval, status")
    .eq("villager_id", villagerId);

  const active = (data ?? []).find((s) =>
    ACTIVE_STATUSES.has(s.status as string)
  );
  return (active as ActiveSubscriptionRow) ?? null;
}

export { ACTIVE_STATUSES };
