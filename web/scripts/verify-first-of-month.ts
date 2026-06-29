/**
 * Stripe TEST-CLOCK verification for first-of-the-month billing (issue #65).
 *
 *   STRIPE_SECRET_KEY=sk_test_... npm run verify:first-of-month
 *   (or put STRIPE_SECRET_KEY in web/.env.local)
 *
 * Exercises the two production paths against a real Stripe test clock and
 * asserts every recurring charge lands on the 1st of the month:
 *
 *   NEW       — the signup flow: a standalone PaymentIntent charges immediately,
 *               then a subscription is created anchored to the first of next
 *               month (same calls the API route + webhook make).
 *   EXISTING  — a plain signup-day monthly subscription migrated onto the 1st
 *               via the real `migrateSubscriptionToFirstOfMonth` helper.
 *
 * Refuses live keys. Deletes each test clock (and its objects) when done.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Stripe from "stripe";
import { firstOfNextMonth } from "../src/lib/billing-anchor";
import { migrateSubscriptionToFirstOfMonth } from "./migrate-to-first-of-month";

function loadEnvLocal(): void {
  if (process.env.STRIPE_SECRET_KEY) return;
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*STRIPE_SECRET_KEY\s*=\s*(.*)\s*$/);
      if (m) {
        process.env.STRIPE_SECRET_KEY = m[1].replace(/^["']|["']$/g, "").trim();
        return;
      }
    }
  } catch {
    /* rely on ambient env */
  }
}
loadEnvLocal();

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toUnix = (d: Date) => Math.floor(d.getTime() / 1000);
const ymd = (u: number) => new Date(u * 1000).toISOString().slice(0, 16);
const dow = (u: number) => WEEKDAYS[new Date(u * 1000).getUTCDay()];
const utc = (y: number, m1: number, d: number, h = 12) => new Date(Date.UTC(y, m1 - 1, d, h));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function advanceTo(stripe: Stripe, clockId: string, when: Date) {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: toUnix(when) });
  for (let i = 0; i < 120; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (c.status === "ready") return;
    if (c.status === "internal_failure") throw new Error("clock internal_failure");
    await sleep(2000);
  }
  throw new Error("clock advance timed out");
}

async function setup(stripe: Stripe, signup: Date) {
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: toUnix(signup) });
  const product = await stripe.products.create({ name: "verify supporter" });
  const customer = await stripe.customers.create({ test_clock: clock.id });
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });
  return { clockId: clock.id, productId: product.id, customerId: customer.id, pmId: pm.id };
}

// Advances across three month boundaries from the anchor, then returns the
// recurring invoices Stripe produced (excluding the immediate signup, which is a
// PaymentIntent, not an invoice).
async function collectAcrossMonths(
  stripe: Stripe,
  clockId: string,
  customerId: string,
  anchor: Date
) {
  for (let k = 1; k <= 3; k++) {
    await advanceTo(stripe, clockId, utc(anchor.getUTCFullYear(), anchor.getUTCMonth() + k, 3));
  }
  const invoices = await stripe.invoices.list({ customer: customerId, limit: 100 });
  return invoices.data
    .filter((inv) => inv.billing_reason !== "subscription_create")
    .map((inv) => ({
      created: inv.created,
      reason: inv.billing_reason ?? "?",
      amount: inv.amount_paid ?? 0,
    }))
    .sort((a, b) => a.created - b.created);
}

function reportAndCheck(label: string, rows: { created: number; reason: string; amount: number }[]): boolean {
  console.log(`\n[${label}] recurring invoices:`);
  let ok = rows.length > 0;
  for (const r of rows) {
    const day = new Date(r.created * 1000).getUTCDate();
    const bad = day !== 1;
    if (bad) ok = false;
    console.log(
      `  ${ymd(r.created)} (${dow(r.created)}) day=${day} $${(r.amount / 100).toFixed(2)} ${r.reason}${bad ? "  <-- NOT the 1st" : ""}`
    );
  }
  if (rows.length === 0) console.log("  (none produced!)");
  return ok;
}

async function verifyNew(stripe: Stripe, signup: Date): Promise<boolean> {
  const { clockId, productId, customerId } = await setup(stripe, signup);
  try {
    const anchor = firstOfNextMonth(signup);
    console.log(`\n=== NEW signup ${ymd(toUnix(signup))} -> anchor ${ymd(toUnix(anchor))} (${dow(toUnix(anchor))}) ===`);

    // Immediate signup fee (the create-subscription route's PaymentIntent).
    const pi = await stripe.paymentIntents.create({
      amount: 1030,
      currency: "cad",
      customer: customerId,
      payment_method: "pm_card_visa",
      setup_future_usage: "off_session",
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    });
    const savedPm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
    console.log(`  signup PaymentIntent: ${pi.status}, $${((pi.amount_received ?? 0) / 100).toFixed(2)} immediate`);
    if (pi.status !== "succeeded") return false;

    // The subscription the webhook creates on payment_intent.succeeded.
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [
        { price_data: { currency: "cad", product: productId, unit_amount: 1030, recurring: { interval: "month" } } },
      ],
      billing_cycle_anchor: toUnix(anchor),
      proration_behavior: "none",
      default_payment_method: savedPm,
      off_session: true,
    });
    console.log(`  subscription: ${sub.status}`);

    const rows = await collectAcrossMonths(stripe, clockId, customerId, anchor);
    return reportAndCheck(`NEW ${ymd(toUnix(signup)).slice(0, 10)}`, rows);
  } finally {
    await stripe.testHelpers.testClocks.del(clockId).catch(() => {});
  }
}

async function verifyExisting(stripe: Stripe, signup: Date): Promise<boolean> {
  const { clockId, productId, customerId, pmId } = await setup(stripe, signup);
  try {
    console.log(`\n=== EXISTING sub created ${ymd(toUnix(signup))} (signup-day billing), then migrated ===`);

    // A pre-existing subscription on signup-day monthly billing.
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [
        { price_data: { currency: "cad", product: productId, unit_amount: 1030, recurring: { interval: "month" } } },
      ],
      default_payment_method: pmId,
    });
    console.log(`  pre-existing subscription: ${sub.status}, day-of-month=${new Date(sub.billing_cycle_anchor * 1000).getUTCDate()}`);

    const anchor = firstOfNextMonth(signup);
    const result = await migrateSubscriptionToFirstOfMonth(stripe, sub, toUnix(anchor));
    console.log(`  migrate result: ${result}, anchor ${ymd(toUnix(anchor))} (${dow(toUnix(anchor))})`);

    const rows = await collectAcrossMonths(stripe, clockId, customerId, anchor);
    return reportAndCheck(`EXISTING ${ymd(toUnix(signup)).slice(0, 10)}`, rows);
  } finally {
    await stripe.testHelpers.testClocks.del(clockId).catch(() => {});
  }
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (key.startsWith("sk_live")) throw new Error("Refusing to run against a LIVE key. Use sk_test_...");
  const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });

  const results: boolean[] = [];
  results.push(await verifyNew(stripe, utc(2026, 6, 10)));
  results.push(await verifyNew(stripe, utc(2026, 6, 30, 20))); // month-end edge
  results.push(await verifyExisting(stripe, utc(2026, 6, 14)));

  console.log("");
  if (results.every(Boolean)) {
    console.log("[verify] PASS — every recurring charge landed on the 1st");
  } else {
    console.error("[verify] FAIL — some charges did not land on the 1st");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[verify] fatal", err);
  process.exit(1);
});
