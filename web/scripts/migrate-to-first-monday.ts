import Stripe from "stripe";
import {
  nextFirstMondayAnchor,
  toUnixSeconds,
  MIGRATION_TAG,
} from "../src/lib/first-monday";
import { enrollSubscriptionOnFirstMonday } from "../src/lib/first-monday-schedule";

const STRIPE_API_VERSION = "2026-04-22.dahlia";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

async function main(): Promise<void> {
  const stripe = getStripe();
  const mode = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live")
    ? "LIVE"
    : "TEST";

  console.log(`[migrate] starting in ${mode} mode (tag=${MIGRATION_TAG})`);
  const anchor = nextFirstMondayAnchor();
  const anchorUnix = toUnixSeconds(anchor);
  console.log(`[migrate] next first-Monday anchor: ${anchor.toISOString()}`);

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
        const result = await enrollSubscriptionOnFirstMonday(
          stripe,
          sub,
          anchorUnix
        );
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
