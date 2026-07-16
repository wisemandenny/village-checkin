import { getStripe, getSupporterProductId } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase/server";
import { recordContribution } from "@/lib/contributions";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  customerIdOf,
  ensureVillager,
  recordKitPurchase,
  reconcileSupporterTags,
  syncSubscriptionFromStripe,
} from "@/lib/subscription-sync";

type SupabaseClient = ReturnType<typeof createServerClient>;

async function villagerIdForCheckIn(
  supabase: SupabaseClient,
  checkInId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("check_ins")
    .select("villager_id")
    .eq("id", checkInId)
    .maybeSingle();
  return data?.villager_id ?? null;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createServerClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const checkInId = session.metadata?.check_in_id;
        if (checkInId) {
          const { error } = await supabase
            .from("check_ins")
            .update({ status: "paid", stripe_transaction_id: session.payment_intent as string })
            .eq("id", checkInId);
          if (error) console.error("[check_ins] update failed", checkInId, error);
          const amount = session.amount_total ?? 0;
          const txnId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? null;
          const villagerId = await villagerIdForCheckIn(supabase, checkInId);
          if (villagerId) {
            await recordContribution(supabase, {
              villagerId,
              amountCents: amount,
              source: "check_in",
              checkInId,
              stripeTransactionId: txnId,
            });
          }
          await recordCheckInPurchase(
            supabase,
            checkInId,
            txnId ?? session.id,
            amount,
            session.currency ?? "cad"
          );
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        // A new supporter just paid their signup fee: create the recurring
        // subscription anchored to the first of next month.
        if (paymentIntent.metadata?.subscription_signup === "true") {
          await handleSubscriptionSignup(supabase, paymentIntent);
          break;
        }
        const checkInId = paymentIntent.metadata?.check_in_id;
        if (checkInId) {
          const viaReminder = paymentIntent.metadata?.via_reminder === "true";
          const { error } = await supabase
            .from("check_ins")
            .update({
              status: "paid",
              payment_method: "online_fallback",
              intent_amount: paymentIntent.amount,
              stripe_transaction_id: paymentIntent.id,
              ...(viaReminder ? { paid_via_reminder: true } : {}),
            })
            .eq("id", checkInId);
          if (error) console.error("[check_ins] update failed", checkInId, error);
          const villagerId = await villagerIdForCheckIn(supabase, checkInId);
          if (villagerId) {
            await recordContribution(supabase, {
              villagerId,
              amountCents: paymentIntent.amount,
              source: "check_in",
              checkInId,
              stripeTransactionId: paymentIntent.id,
            });
          }
          await recordCheckInPurchase(
            supabase,
            checkInId,
            paymentIntent.id,
            paymentIntent.amount,
            paymentIntent.currency
          );
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await handleSubscriptionEvent(supabase, event);
        break;
      }

      case "invoice.paid": {
        await handleInvoicePaid(supabase, event.data.object);
        break;
      }
    }
  } catch (err) {
    // Log but still return 200: a downstream failure (e.g. Kit) should not
    // trigger endless Stripe retries. Reconcile via the admin refresh action.
    console.error(`[webhook] handler error for ${event.type}`, err);
  }

  return NextResponse.json({ received: true });
}

async function recordCheckInPurchase(
  supabase: SupabaseClient,
  checkInId: string,
  transactionId: string,
  amountCents: number,
  currency: string
): Promise<void> {
  const { data: checkIn } = await supabase
    .from("check_ins")
    .select("villager_id")
    .eq("id", checkInId)
    .maybeSingle();
  if (!checkIn?.villager_id) return;

  const { data: villager } = await supabase
    .from("villagers")
    .select("email")
    .eq("id", checkIn.villager_id)
    .maybeSingle();

  await recordKitPurchase(villager?.email ?? null, {
    transactionId,
    amountCents,
    currency,
    productName: "Village Check-in Donation",
    productId: "checkin-donation",
  });
}

async function handleSubscriptionEvent(
  supabase: SupabaseClient,
  event: Stripe.Event
): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;

  if (event.type === "customer.subscription.deleted") {
    const customerId = customerIdOf(sub.customer);
    const meta = sub.metadata ?? {};

    const villager = await ensureVillager(supabase, {
      villagerId: meta.villager_id,
      customerId,
      email: meta.email,
    });

    const { error } = await supabase
      .from("subscriptions")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("stripe_subscription_id", sub.id);
    if (error) console.error("[subscriptions] cancel update failed", sub.id, error);

    // Recompute tags from the villager's remaining active subscriptions.
    if (villager) await reconcileSupporterTags(supabase, villager);
    return;
  }

  await syncSubscriptionFromStripe(supabase, sub);
}

async function handleInvoicePaid(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice
): Promise<void> {
  if ((invoice.amount_paid ?? 0) <= 0) return;
  if (!invoice.id) return;

  // Subscription renewals/create have parent.subscription_details. Manual
  // one-off invoices (e.g. bill-now-and-anchor) do not — still count those
  // toward contributions when we can resolve the villager.
  const subDetails = invoice.parent?.subscription_details ?? null;
  const meta = subDetails?.metadata ?? {};
  const customerId = customerIdOf(invoice.customer);
  const email = invoice.customer_email ?? meta.email ?? null;
  const stripeSubId = customerIdOf(subDetails?.subscription);

  let villager = await ensureVillager(supabase, {
    villagerId: meta.villager_id,
    customerId,
    email,
  });

  // Older pledges may lack villager_id on subscription metadata — fall back to
  // our mirrored subscriptions row.
  if (!villager && stripeSubId) {
    const { data: subRow } = await supabase
      .from("subscriptions")
      .select("villager_id")
      .eq("stripe_subscription_id", stripeSubId)
      .maybeSingle();
    if (subRow?.villager_id) {
      villager = await ensureVillager(supabase, {
        villagerId: subRow.villager_id,
        customerId,
        email,
      });
    }
  }

  // Kit purchase tracking stays subscription-invoice-only (unchanged behavior).
  if (subDetails) {
    await recordKitPurchase(villager?.email ?? email, {
      transactionId: invoice.id,
      amountCents: invoice.amount_paid,
      currency: invoice.currency,
      productName: "Village Supporter",
      productId: "village-supporter",
    });

    // When a recurring subscription is first set up during check-in, mark that
    // check-in as paid (only the first invoice carries a fresh check_in_id).
    const checkInId =
      invoice.billing_reason === "subscription_create" && meta.check_in_id
        ? meta.check_in_id
        : null;
    if (checkInId) {
      const { error } = await supabase
        .from("check_ins")
        .update({
          status: "paid",
          payment_method: "online_fallback",
          intent_amount: invoice.amount_paid,
          stripe_transaction_id: invoice.id,
        })
        .eq("id", checkInId);
      if (error)
        console.error("[check_ins] recurring mark-paid failed", checkInId, error);
    }

    if (villager) {
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
    return;
  }

  // Manual / one-off paid invoice linked to a known villager (supporter fees
  // charged outside the normal subscription invoice parent shape).
  if (villager) {
    await recordContribution(supabase, {
      villagerId: villager.id,
      amountCents: invoice.amount_paid,
      source: "subscription_invoice",
      stripeTransactionId: invoice.id,
      createdAt: invoice.status_transitions?.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
        : undefined,
    });
  }
}

// Creates the recurring subscription after a new supporter's signup fee is paid.
// The subscription is anchored to the first of next month with no proration, so
// the next charge lands on the 1st and every month after that bills on the 1st
// natively (no schedules, no cron). The card saved by the signup PaymentIntent
// pays each cycle.
async function handleSubscriptionSignup(
  supabase: SupabaseClient,
  pi: Stripe.PaymentIntent
): Promise<void> {
  const meta = pi.metadata ?? {};
  const customerId = customerIdOf(pi.customer);
  const amount = pi.amount_received ?? pi.amount ?? 0;

  // The PaymentIntent already succeeded — record the contribution even if we
  // can't create the recurring subscription (bad/missing anchor metadata).
  const villager = await ensureVillager(supabase, {
    villagerId: meta.villager_id,
    customerId,
    email: pi.receipt_email,
  });

  await recordKitPurchase(villager?.email ?? pi.receipt_email ?? null, {
    transactionId: pi.id,
    amountCents: amount,
    currency: pi.currency,
    productName: "Village Supporter",
    productId: "village-supporter",
  });

  if (meta.check_in_id) {
    const { error } = await supabase
      .from("check_ins")
      .update({
        status: "paid",
        payment_method: "online_fallback",
        intent_amount: amount,
        stripe_transaction_id: pi.id,
      })
      .eq("id", meta.check_in_id);
    if (error)
      console.error("[check_ins] subscription signup mark-paid failed", meta.check_in_id, error);
  }

  if (villager) {
    await recordContribution(supabase, {
      villagerId: villager.id,
      amountCents: amount,
      source: "subscription_signup",
      checkInId: meta.check_in_id || null,
      stripeTransactionId: pi.id,
    });
  }

  const anchorUnix = Number(meta.first_of_month_anchor);
  const recurringAmount = Number(meta.recurring_amount);

  if (
    !customerId ||
    !Number.isFinite(anchorUnix) ||
    anchorUnix <= 0 ||
    !Number.isFinite(recurringAmount) ||
    recurringAmount <= 0
  ) {
    console.error("[webhook] subscription signup missing data", pi.id);
    return;
  }

  const stripe = getStripe();
  const savedPm =
    typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;

  // Idempotent per signup PaymentIntent so a webhook redelivery doesn't create a
  // duplicate subscription. (A duplicate would also be retired by the
  // single-active-pledge reconcile, but avoiding it is cleaner.)
  try {
    const productId = await getSupporterProductId(stripe);
    await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [
          {
            price_data: {
              currency: pi.currency,
              product: productId,
              unit_amount: recurringAmount,
              recurring: { interval: "month" },
            },
          },
        ],
        billing_cycle_anchor: anchorUnix,
        proration_behavior: "none",
        ...(savedPm ? { default_payment_method: savedPm } : {}),
        off_session: true,
        metadata: {
          villager_id: meta.villager_id ?? "",
          device_id: meta.device_id ?? "",
          ...(meta.check_in_id ? { check_in_id: meta.check_in_id } : {}),
        },
      },
      { idempotencyKey: `sub-signup-${pi.id}` }
    );
  } catch (err) {
    // The signup fee is still paid; the subscription just wasn't created. Surface
    // it — re-running the migration (or a manual retry) recovers the pledge.
    console.error("[webhook] subscription signup create failed", pi.id, err);
  }
}
