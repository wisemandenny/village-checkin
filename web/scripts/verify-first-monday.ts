/**
 * Verification for the new-subscriber first-Monday billing (issue #65, cases C & D).
 *
 *   npm run verify:first-monday
 *
 * Part 1 (always) runs offline assertions on the date math.
 * Part 2 (only with a TEST STRIPE_SECRET_KEY) exercises the real Stripe flow:
 * it creates a customer + auto-paid subscription shaped like /api/create-subscription,
 * runs the same enrollment the webhook performs, and asserts the resulting
 * Subscription Schedule is anchored to next month's first Monday and tagged.
 *
 * A LIVE key is refused. All test objects are cleaned up in a finally block.
 */
import Stripe from "stripe";
import {
  getFirstMondayOfMonth,
  firstMondayOfNextMonth,
  toUnixSeconds,
  MIGRATION_TAG,
} from "../src/lib/first-monday";
import { enrollSubscriptionOnFirstMonday } from "../src/lib/first-monday-schedule";

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function checkDate(label: string, actual: Date, expected: string): void {
  check(label, ymd(actual) === expected, `expected ${expected}, got ${ymd(actual)}`);
}

// ---------------------------------------------------------------------------
// Part 1 — offline date math
// ---------------------------------------------------------------------------
function verifyDateMath(): void {
  console.log("[verify] date math");

  // getFirstMondayOfMonth: 1st falls mid-week → first Monday is later.
  checkDate("first Monday Jul 2026 (1st = Wed)", getFirstMondayOfMonth(2026, 6), "2026-07-06");
  checkDate("first Monday Aug 2026 (1st = Sat)", getFirstMondayOfMonth(2026, 7), "2026-08-03");
  // Edge: the 1st itself is a Monday → first Monday is the 1st.
  checkDate("first Monday Jun 2026 (1st = Mon)", getFirstMondayOfMonth(2026, 5), "2026-06-01");
  // Year rollover via month index 12.
  checkDate("first Monday Jan 2027 (Dec +1)", getFirstMondayOfMonth(2026, 12), "2027-01-04");

  // firstMondayOfNextMonth drives cases C & D — always next month, regardless of
  // where in the current month the signup happens.
  checkDate(
    "C: signup before this month's 1st Monday (Jul 2) → next month",
    firstMondayOfNextMonth(new Date("2026-07-02T15:00:00Z")),
    "2026-08-03"
  );
  checkDate(
    "D: signup after this month's 1st Monday (Jul 20) → next month",
    firstMondayOfNextMonth(new Date("2026-07-20T15:00:00Z")),
    "2026-08-03"
  );
  // Late-month signup (literal short first cycle, as specified).
  checkDate(
    "D: late-month signup (Jul 31) → next month's 1st Monday",
    firstMondayOfNextMonth(new Date("2026-07-31T23:00:00Z")),
    "2026-08-03"
  );
  // December signup rolls into the next year.
  checkDate(
    "Dec signup → Jan first Monday (year rollover)",
    firstMondayOfNextMonth(new Date("2026-12-15T12:00:00Z")),
    "2027-01-04"
  );
}

// ---------------------------------------------------------------------------
// Part 2 — live Stripe (test mode only)
// ---------------------------------------------------------------------------
async function verifyStripeFlow(stripe: Stripe): Promise<void> {
  console.log("[verify] Stripe test-mode flow (cases C & D)");

  const chargeAmount = 1030; // matches exclusiveMonthlyTotalCents()-ish; value is arbitrary here
  const anchor = firstMondayOfNextMonth();
  const anchorUnix = toUnixSeconds(anchor);

  let customerId: string | undefined;
  let scheduleId: string | undefined;

  try {
    const product = await stripe.products.create({
      name: "Verify Supporter (test)",
    });

    const customer = await stripe.customers.create({
      name: "First-Monday Verify",
      metadata: { _verify: "first-monday" },
    });
    customerId = customer.id;

    // Attach a test card and make it the default so the first invoice auto-pays
    // (stands in for the inline Elements confirmation the real app does).
    const pm = await stripe.paymentMethods.attach("pm_card_visa", {
      customer: customer.id,
    });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: pm.id },
    });

    // Shaped like /api/create-subscription: immediate full charge, with the
    // anchor + pending flag in metadata. (Auto-charge instead of
    // default_incomplete so the script can run headless.)
    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price_data: {
            currency: "cad",
            product: product.id,
            unit_amount: chargeAmount,
            recurring: { interval: "month" },
          },
        },
      ],
      default_payment_method: pm.id,
      metadata: {
        first_monday_anchor: String(anchorUnix),
        first_monday_pending: "true",
      },
    });

    check("subscription is active after signup charge", sub.status === "active", `status=${sub.status}`);

    // Stand in for the invoice.paid webhook.
    const fresh = await stripe.subscriptions.retrieve(sub.id);
    const result = await enrollSubscriptionOnFirstMonday(stripe, fresh, anchorUnix);
    check("enroll returns OK on first run", result === "OK", `got ${result}`);

    const afterEnroll = await stripe.subscriptions.retrieve(sub.id);
    check("subscription tagged after enroll", afterEnroll.metadata?.[MIGRATION_TAG] === "true");
    check("subscription now has a schedule", Boolean(afterEnroll.schedule));

    scheduleId =
      typeof afterEnroll.schedule === "string"
        ? afterEnroll.schedule
        : afterEnroll.schedule?.id;

    if (scheduleId) {
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      check("schedule end_behavior is release", schedule.end_behavior === "release");
      check("schedule has 2 phases (stub + first-Monday)", schedule.phases.length === 2, `phases=${schedule.phases.length}`);

      const stub = schedule.phases[0];
      const firstMonday = schedule.phases[schedule.phases.length - 1];

      check("stub phase ends at the anchor", stub?.end_date === anchorUnix, `end_date=${stub?.end_date} anchor=${anchorUnix}`);
      check("first-Monday phase starts at the anchor", firstMonday?.start_date === anchorUnix, `start_date=${firstMonday?.start_date} anchor=${anchorUnix}`);
      check("first-Monday phase re-anchors billing to phase start", firstMonday?.billing_cycle_anchor === "phase_start", `got ${firstMonday?.billing_cycle_anchor}`);
      check("first-Monday phase is tagged", firstMonday?.metadata?.[MIGRATION_TAG] === "true");

      const startDow = new Date((firstMonday?.start_date ?? 0) * 1000).getUTCDay();
      check("anchor lands on a Monday (UTC)", startDow === 1, `getUTCDay=${startDow}`);
    }

    // Idempotency: a redelivered webhook must not double-wrap.
    const again = await enrollSubscriptionOnFirstMonday(
      stripe,
      await stripe.subscriptions.retrieve(sub.id),
      anchorUnix
    );
    check("enroll returns SKIP on re-run (idempotent)", again === "SKIP", `got ${again}`);
  } finally {
    // Best-effort cleanup. Releasing the schedule detaches it; deleting the
    // customer cancels the subscription.
    if (scheduleId) {
      await stripe.subscriptionSchedules.release(scheduleId).catch(() => {});
    }
    if (customerId) {
      await stripe.customers.del(customerId).catch(() => {});
    }
  }
}

async function main(): Promise<void> {
  verifyDateMath();

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.log(
      "\n[verify] STRIPE_SECRET_KEY not set — skipping live Stripe checks (date math only)."
    );
  } else if (key.startsWith("sk_live")) {
    throw new Error("Refusing to run against a LIVE Stripe key. Use sk_test_...");
  } else {
    const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
    console.log("");
    await verifyStripeFlow(stripe);
  }

  console.log("");
  if (failures > 0) {
    console.error(`[verify] FAILED — ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("[verify] all checks passed");
}

main().catch((err) => {
  console.error("[verify] fatal", err);
  process.exit(1);
});
