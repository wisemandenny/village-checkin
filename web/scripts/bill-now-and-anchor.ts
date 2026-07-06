/**
 * One-time script: immediately charge all active subscribers the full monthly
 * fee, then suppress billing until August 1 and permanently anchor to the 1st.
 *
 * Mechanism for the anchor: setting trial_end=Aug1 on a subscription prevents
 * any invoice from being generated until Aug 1, and when the trial ends Stripe
 * automatically sets billing_cycle_anchor to Aug 1 — so Sep 1, Oct 1, etc.
 * follow with no further intervention.
 *
 * Exception: winniewongsings@gmail.com has already paid July — skip the
 * immediate charge but still fix her anchor.
 *
 * Idempotent in two stages:
 *   billing_jul2026_invoiced=true  → invoice already paid, skip billing only
 *   billing_jul2026_fixed=true     → fully done, skip entirely
 *
 *   STRIPE_SECRET_KEY=sk_test_... npm run bill:now-and-anchor
 */
import Stripe from "stripe";
import { firstOfNextMonth, toUnixSeconds } from "../src/lib/billing-anchor";

const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;
const INVOICED_TAG = "billing_jul2026_invoiced";
const ANCHORED_TAG = "billing_jul2026_fixed";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

async function anchorToFirstOfMonth(
  stripe: Stripe,
  sub: Stripe.Subscription,
  anchorUnix: number
): Promise<void> {
  // Release any existing schedule first. Stripe won't let us set trial_end on
  // a subscription that is actively managed by a schedule.
  if (sub.schedule) {
    const scheduleId =
      typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
    await stripe.subscriptionSchedules.release(scheduleId);
  }

  // trial_end does two things at once:
  //   1. Suppresses all invoices between now and Aug 1 (trial = no billing)
  //   2. When the trial ends, Stripe sets billing_cycle_anchor = Aug 1
  //      so subsequent months land on Sep 1, Oct 1, etc. automatically.
  await stripe.subscriptions.update(sub.id, {
    trial_end: anchorUnix,
    proration_behavior: "none",
  });
}

async function main(): Promise<void> {
  const stripe = getStripe();
  const mode = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live")
    ? "LIVE"
    : "TEST";

  const anchorUnix = toUnixSeconds(firstOfNextMonth());
  console.log(
    `[bill-now] ${mode} mode | anchor=${new Date(anchorUnix * 1000).toISOString()}`
  );

  let billed = 0;
  let anchorOnly = 0;
  let skipped = 0;
  let failed = 0;
  let startingAfter: string | undefined;

  for (;;) {
    const page = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      starting_after: startingAfter,
      expand: ["data.customer"],
    });

    for (const sub of page.data) {
      const customer = sub.customer as Stripe.Customer;
      const email = customer.email ?? "";

      if (sub.metadata?.[ANCHORED_TAG] === "true") {
        skipped++;
        console.log(`[bill-now] SKIP        ${sub.id} (${email})`);
        continue;
      }

      const skipBilling = sub.metadata?.[INVOICED_TAG] === "true";

      try {
        if (!skipBilling) {
          const monthlyAmount = sub.items.data.reduce(
            (sum: number, item: Stripe.SubscriptionItem) =>
              sum + (item.price.unit_amount ?? 0) * (item.quantity ?? 1),
            0
          );

          const draft = await stripe.invoices.create({
            customer: customer.id,
            auto_advance: false,
            pending_invoice_items_behavior: "exclude",
          });

          await stripe.invoiceItems.create({
            customer: customer.id,
            invoice: draft.id,
            amount: monthlyAmount,
            currency: sub.currency,
            description: "Village Supporter — July 2026",
          });

          const pm =
            sub.default_payment_method ??
            customer.invoice_settings?.default_payment_method;
          const pmId = typeof pm === "string" ? pm : pm?.id;
          if (!pmId)
            throw new Error(
              "no default_payment_method on subscription or customer"
            );

          await stripe.invoices.finalizeInvoice(draft.id);
          await stripe.invoices.pay(draft.id, {
            payment_method: pmId,
            off_session: true,
          });

          // Tag billing immediately — if the anchor step below fails, a re-run
          // skips billing and only retries the anchor.
          await stripe.subscriptions.update(sub.id, {
            metadata: { ...sub.metadata, [INVOICED_TAG]: "true" },
          });
        }

        await anchorToFirstOfMonth(stripe, sub, anchorUnix);

        await stripe.subscriptions.update(sub.id, {
          metadata: {
            ...sub.metadata,
            [INVOICED_TAG]: "true",
            [ANCHORED_TAG]: "true",
          },
        });

        if (skipBilling) {
          anchorOnly++;
          console.log(`[bill-now] ANCHOR_ONLY ${sub.id} (${email})`);
        } else {
          billed++;
          console.log(`[bill-now] BILLED      ${sub.id} (${email})`);
        }
      } catch (err) {
        failed++;
        console.error(
          `[bill-now] FAIL        ${sub.id} (${email}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  console.log(
    `[bill-now] done — billed=${billed} anchorOnly=${anchorOnly} skipped=${skipped} failed=${failed}`
  );
}

main().catch((err) => {
  console.error("[bill-now] fatal", err);
  process.exit(1);
});
