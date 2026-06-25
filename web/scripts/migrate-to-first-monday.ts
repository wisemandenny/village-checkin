/**
 * One-time migration: wrap every active Stripe subscription in a Subscription
 * Schedule whose billing boundary lands on the first Monday of the month.
 *
 * Stripe's `billing_cycle_anchor` can only lock a fixed calendar day, but the
 * first Monday shifts between the 1st and 7th, so we use Subscription Schedules
 * with phase boundaries anchored to a computed first-Monday date. A companion
 * Vercel cron (`/api/cron/extend-schedules`) keeps each schedule extended one
 * phase ahead.
 *
 * Run against TEST MODE first:
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/migrate-to-first-monday.ts
 *
 * The script is idempotent: subscriptions already on a schedule or already
 * tagged `first_monday_billing` are skipped, so it is safe to re-run.
 */
import Stripe from "stripe";
import {
  nextFirstMondayAnchor,
  toUnixSeconds,
  MIGRATION_TAG,
} from "../src/lib/first-monday";

// Pin the same API version the rest of the app uses (see src/lib/stripe.ts).
const STRIPE_API_VERSION = "2026-04-22.dahlia";

// No charge for the stub period between now and the first new first-Monday
// cycle. Flip to "create_prorations" to bill/credit the partial period.
const PRORATION_BEHAVIOR: Stripe.SubscriptionScheduleUpdateParams.Phase["proration_behavior"] =
  "none";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

// Extracts { price, quantity } pairs from a subscription's items for reuse in
// schedule phases.
function itemsFromSubscription(
  sub: Stripe.Subscription
): Array<{ price: string; quantity: number }> {
  return sub.items.data.map((item) => ({
    price: typeof item.price === "string" ? item.price : item.price.id,
    quantity: item.quantity ?? 1,
  }));
}

function scheduleIdOf(value: string | Stripe.SubscriptionSchedule): string {
  return typeof value === "string" ? value : value.id;
}

async function migrateSubscription(
  stripe: Stripe,
  sub: Stripe.Subscription
): Promise<"OK" | "SKIP"> {
  if (sub.metadata?.[MIGRATION_TAG] === "true") return "SKIP";

  const items = itemsFromSubscription(sub);
  if (items.length === 0) {
    throw new Error(`subscription ${sub.id} has no items`);
  }

  const anchor = nextFirstMondayAnchor();
  const anchorUnix = toUnixSeconds(anchor);

  // Reuse an existing schedule if one is already attached. This makes a prior
  // partial run recoverable: if `create` succeeded but `update` failed, the
  // subscription has an untagged default schedule — we re-run the update on it
  // rather than skipping (which would leave it stranded, invisible to the cron).
  let scheduleId: string;
  if (sub.schedule) {
    const existing = await stripe.subscriptionSchedules.retrieve(
      scheduleIdOf(sub.schedule)
    );
    const lastPhase = existing.phases[existing.phases.length - 1];
    if (lastPhase?.metadata?.[MIGRATION_TAG] === "true") return "SKIP";
    scheduleId = existing.id;
  } else {
    const created = await stripe.subscriptionSchedules.create({
      from_subscription: sub.id,
    });
    scheduleId = created.id;
  }

  // Re-fetch so phases[0] reflects the current subscription period regardless
  // of whether we just created or are reusing a schedule.
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const currentPhase = schedule.phases[0];

  await stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: "release",
    metadata: { [MIGRATION_TAG]: "true" },
    phases: [
      // Stub phase: carry the current subscription unchanged until the first
      // first-Monday anchor. No proration by default (just a free tail).
      {
        items,
        start_date: currentPhase.start_date,
        end_date: anchorUnix,
        proration_behavior: PRORATION_BEHAVIOR,
      },
      // First-Monday phase: billing re-anchors to the first Monday and the
      // customer is charged a full period at phase start. Left open-ended so
      // billing never stops if the cron lapses; the cron closes/extends it.
      {
        items,
        start_date: anchorUnix,
        billing_cycle_anchor: "phase_start",
        proration_behavior: "none",
        metadata: { [MIGRATION_TAG]: "true" },
      },
    ],
  });

  // Tag the subscription itself so re-runs skip it cheaply (without a schedule
  // round-trip) and so the tag is visible on the subscription in the Dashboard.
  await stripe.subscriptions.update(sub.id, {
    metadata: { ...sub.metadata, [MIGRATION_TAG]: "true" },
  });

  return "OK";
}

async function main(): Promise<void> {
  const stripe = getStripe();
  const mode = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live")
    ? "LIVE"
    : "TEST";

  console.log(`[migrate] starting in ${mode} mode (tag=${MIGRATION_TAG})`);
  const upcoming = nextFirstMondayAnchor();
  console.log(`[migrate] next first-Monday anchor: ${upcoming.toISOString()}`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let startingAfter: string | undefined;

  // Paginate through every active subscription (pages of 100).
  for (;;) {
    const page = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      starting_after: startingAfter,
    });

    for (const sub of page.data) {
      try {
        const result = await migrateSubscription(stripe, sub);
        if (result === "OK") {
          migrated++;
          console.log(`[migrate] OK   ${sub.id}`);
        } else {
          skipped++;
          console.log(`[migrate] SKIP ${sub.id} (already on schedule/tagged)`);
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[migrate] FAIL ${sub.id}: ${msg}`);
      }
    }

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  console.log(
    `[migrate] done — migrated=${migrated} skipped=${skipped} failed=${failed}`
  );
}

main().catch((err) => {
  console.error("[migrate] fatal", err);
  process.exit(1);
});
