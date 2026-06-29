/**
 * One-time, idempotent migration: move every active Stripe subscription onto
 * first-of-the-month billing.
 *
 *   STRIPE_SECRET_KEY=sk_test_... npm run migrate:first-of-month
 *
 * Mechanism: wrap each subscription in a short-lived Subscription Schedule with
 * two phases — the current period through the first of next month (no proration,
 * so nothing extra is charged now), then an open-ended phase anchored to the
 * first of the month. `end_behavior: release` makes Stripe hand the subscription
 * back to native monthly billing once it enters that phase, with the cycle now
 * anchored to the 1st. Because the 1st is a fixed calendar day, no cron is needed
 * to keep it there.
 *
 * Re-running is safe: subscriptions already tagged are skipped.
 */
import Stripe from "stripe";
import { firstOfNextMonth, toUnixSeconds, MIGRATION_TAG } from "../src/lib/billing-anchor";

const STRIPE_API_VERSION = "2026-04-22.dahlia";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

function itemsFromSubscription(
  sub: Stripe.Subscription
): Stripe.SubscriptionScheduleUpdateParams.Phase["items"] {
  return sub.items.data.map((item) => ({
    price: typeof item.price === "string" ? item.price : item.price.id,
    quantity: item.quantity ?? 1,
  }));
}

// Moves a single subscription onto first-of-month billing. Exported so the
// test-clock verifier can exercise the exact production path.
export async function migrateSubscriptionToFirstOfMonth(
  stripe: Stripe,
  sub: Stripe.Subscription,
  anchorUnix: number
): Promise<"OK" | "SKIP"> {
  if (sub.metadata?.[MIGRATION_TAG] === "true") return "SKIP";

  const items = itemsFromSubscription(sub);
  if (items.length === 0) throw new Error(`subscription ${sub.id} has no items`);

  let scheduleId: string;
  if (sub.schedule) {
    scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
    const existing = await stripe.subscriptionSchedules.retrieve(scheduleId);
    const lastPhase = existing.phases[existing.phases.length - 1];
    if (lastPhase?.metadata?.[MIGRATION_TAG] === "true") return "SKIP";
  } else {
    const created = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
    scheduleId = created.id;
  }

  // Re-fetch so phases[0] reflects the current period regardless of whether we
  // just created the schedule or are reusing an existing one.
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const currentPhase = schedule.phases[0];

  await stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: "release",
    metadata: { [MIGRATION_TAG]: "true" },
    phases: [
      {
        items,
        start_date: currentPhase.start_date,
        end_date: anchorUnix,
        proration_behavior: "none",
      },
      {
        items,
        start_date: anchorUnix,
        billing_cycle_anchor: "phase_start",
        proration_behavior: "none",
        metadata: { [MIGRATION_TAG]: "true" },
      },
    ],
  });

  await stripe.subscriptions.update(sub.id, {
    metadata: { ...sub.metadata, [MIGRATION_TAG]: "true" },
  });

  return "OK";
}

async function main(): Promise<void> {
  const stripe = getStripe();
  const mode = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live") ? "LIVE" : "TEST";

  const anchorUnix = toUnixSeconds(firstOfNextMonth());
  console.log(
    `[migrate] starting in ${mode} mode (tag=${MIGRATION_TAG}); anchor=${new Date(anchorUnix * 1000).toISOString()}`
  );

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let startingAfter: string | undefined;

  for (;;) {
    const page = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      starting_after: startingAfter,
    });

    for (const sub of page.data) {
      try {
        const result = await migrateSubscriptionToFirstOfMonth(stripe, sub, anchorUnix);
        if (result === "OK") {
          migrated++;
          console.log(`[migrate] OK   ${sub.id}`);
        } else {
          skipped++;
          console.log(`[migrate] SKIP ${sub.id} (already migrated)`);
        }
      } catch (err) {
        failed++;
        console.error(`[migrate] FAIL ${sub.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  console.log(`[migrate] done — migrated=${migrated} skipped=${skipped} failed=${failed}`);
}

// Only run the migration when invoked directly (not when imported by the verifier).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[migrate] fatal", err);
    process.exit(1);
  });
}
