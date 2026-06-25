import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import {
  nextFirstMondayAnchor,
  getFirstMondayOfMonth,
  toUnixSeconds,
  MIGRATION_TAG,
} from "@/lib/first-monday";

// Cron handlers must always run at request time, never be prerendered/cached.
export const dynamic = "force-dynamic";

function lastPhaseHasTag(schedule: Stripe.SubscriptionSchedule): boolean {
  const last = schedule.phases[schedule.phases.length - 1];
  return last?.metadata?.[MIGRATION_TAG] === "true";
}

// Maps an existing (returned) phase into update params, preserving its items,
// boundaries and tag. price/product may come back expanded, so normalize to ids.
function phaseToParams(
  phase: Stripe.SubscriptionSchedule.Phase
): Stripe.SubscriptionScheduleUpdateParams.Phase {
  const items = phase.items.map((item) => ({
    price: typeof item.price === "string" ? item.price : item.price.id,
    quantity: item.quantity ?? 1,
  }));
  const params: Stripe.SubscriptionScheduleUpdateParams.Phase = {
    items,
    start_date: phase.start_date,
    end_date: phase.end_date,
  };
  if (phase.metadata && Object.keys(phase.metadata).length > 0) {
    params.metadata = phase.metadata;
  }
  return params;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripe();
  const ranAt = new Date().toISOString();

  // The far boundary we extend each schedule out to: the first Monday of the
  // month AFTER the next upcoming first Monday. Keeping every schedule's open
  // phase starting at/after this point means it is always ≥1 full first-Monday
  // period ahead of "now", which both prevents drift and makes this idempotent.
  const nextAnchor = nextFirstMondayAnchor();
  const farBoundary = getFirstMondayOfMonth(
    nextAnchor.getUTCFullYear(),
    nextAnchor.getUTCMonth() + 1
  );
  const farBoundaryUnix = toUnixSeconds(farBoundary);

  const extendedScheduleIds: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.subscriptionSchedules.list({
      limit: 100,
      starting_after: startingAfter,
    });

    for (const schedule of page.data) {
      if (schedule.status !== "active") continue;
      if (!lastPhaseHasTag(schedule)) continue;

      const lastPhase = schedule.phases[schedule.phases.length - 1];

      // Already extended far enough — running again in the cron window is a no-op.
      if (lastPhase.start_date >= farBoundaryUnix) continue;

      try {
        const priorPhases = schedule.phases
          .slice(0, -1)
          .map((phase) => phaseToParams(phase));

        // Close the previously-open phase at the new boundary, preserving the
        // billing config it was created with (`phase_start` anchor + proration)
        // so the segment keeps billing on its first Monday rather than silently
        // reverting to Stripe's `automatic` default.
        const closedLast: Stripe.SubscriptionScheduleUpdateParams.Phase = {
          ...phaseToParams(lastPhase),
          end_date: farBoundaryUnix,
          proration_behavior: lastPhase.proration_behavior,
        };
        if (lastPhase.billing_cycle_anchor) {
          closedLast.billing_cycle_anchor = lastPhase.billing_cycle_anchor;
        }

        // ...and append a fresh open-ended first-Monday phase at the boundary.
        const items = lastPhase.items.map((item) => ({
          price: typeof item.price === "string" ? item.price : item.price.id,
          quantity: item.quantity ?? 1,
        }));
        const newPhase: Stripe.SubscriptionScheduleUpdateParams.Phase = {
          items,
          start_date: farBoundaryUnix,
          billing_cycle_anchor: "phase_start",
          proration_behavior: "none",
          metadata: { [MIGRATION_TAG]: "true" },
        };

        await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: "release",
          phases: [...priorPhases, closedLast, newPhase],
        });
        extendedScheduleIds.push(schedule.id);
      } catch (err) {
        errors.push({
          id: schedule.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  return NextResponse.json({
    ranAt,
    extendedCount: extendedScheduleIds.length,
    extendedScheduleIds,
    errors,
  });
}
