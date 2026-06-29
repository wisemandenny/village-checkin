import type Stripe from "stripe";
import { MIGRATION_TAG } from "./first-monday";

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

/**
 * Wrap an active subscription in a Subscription Schedule whose recurring billing
 * re-anchors to a first Monday (`anchorUnix`, a UTC unix timestamp), and tag it
 * so the extend cron keeps it one phase ahead. Stripe's `billing_cycle_anchor`
 * can only lock a fixed day-of-month, so the schedule's explicit phase
 * boundaries are what actually pin billing to the (shifting) first Monday.
 *
 * Idempotent: an already-tagged subscription (or one whose attached schedule's
 * last phase is tagged) returns "SKIP". Recovers from a partial run by reusing
 * an attached-but-untagged schedule rather than stranding it.
 *
 * The stub phase carries the current period unchanged until the anchor with no
 * proration — the caller is responsible for whatever charge (if any) covers
 * that gap (the migration leaves it as a free tail; new signups pay in full at
 * creation).
 */
export async function enrollSubscriptionOnFirstMonday(
  stripe: Stripe,
  sub: Stripe.Subscription,
  anchorUnix: number
): Promise<"OK" | "SKIP"> {
  if (sub.metadata?.[MIGRATION_TAG] === "true") return "SKIP";

  const items = itemsFromSubscription(sub);
  if (items.length === 0) {
    throw new Error(`subscription ${sub.id} has no items`);
  }

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
