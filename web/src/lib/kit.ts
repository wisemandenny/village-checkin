// Kit (formerly ConvertKit) API v4 client.
// Server-only. Mirrors the lazy-config pattern used by lib/stripe.ts.
// Docs: https://developers.kit.com/api-reference

const KIT_API_BASE = "https://api.kit.com/v4";

export interface KitSubscriber {
  id: number;
  email_address: string;
  first_name: string | null;
  state: string;
}

function getApiKey(): string {
  const key = process.env.KIT_API_KEY;
  if (!key) {
    throw new Error("KIT_API_KEY is not set");
  }
  return key;
}

export function isKitConfigured(): boolean {
  return Boolean(process.env.KIT_API_KEY);
}

export function getKitFormId(): number | null {
  const id = process.env.KIT_FORM_ID;
  return id ? Number(id) : null;
}

export function getKitTagId(interval: "week" | "month"): number | null {
  const raw =
    interval === "week"
      ? process.env.KIT_TAG_WEEKLY_ID
      : process.env.KIT_TAG_MONTHLY_ID;
  return raw ? Number(raw) : null;
}

export function getAllKitTagIds(): number[] {
  return [getKitTagId("week"), getKitTagId("month")].filter(
    (id): id is number => id !== null
  );
}

interface KitFetchOptions {
  method?: string;
  body?: unknown;
  // HTTP statuses that should be treated as success (e.g. 404 on a delete).
  tolerate?: number[];
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function kitFetch(path: string, opts: KitFetchOptions = {}): Promise<unknown> {
  const { method = "GET", body, tolerate = [] } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${KIT_API_BASE}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Kit-Api-Key": getApiKey(),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      // Network error or timeout: retry with backoff.
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 500);
      continue;
    }

    if (res.status === 204 || tolerate.includes(res.status)) {
      return null;
    }

    // Retry transient errors (rate limit / server) before giving up.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      lastError = new Error(`Kit API ${res.status} on ${path}`);
      await sleep(attempt * 500);
      continue;
    }

    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const data = (await res.json()) as { errors?: string[] };
        if (data?.errors?.length) detail = data.errors.join("; ");
      } catch {
        // non-JSON error body; keep status text
      }
      throw new Error(`Kit API error (${path}): ${detail}`);
    }

    return res.json();
  }

  throw new Error(
    `Kit API request failed after ${MAX_ATTEMPTS} attempts (${path}): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

export async function findSubscriberByEmail(
  email: string
): Promise<KitSubscriber | null> {
  const data = (await kitFetch(
    `/subscribers?email_address=${encodeURIComponent(email)}`
  )) as { subscribers?: KitSubscriber[] } | null;
  return data?.subscribers?.[0] ?? null;
}

// Subscribes the email to the configured Kit Form (which can trigger a
// welcome sequence). Falls back to a plain subscriber upsert if no form is
// configured. Behaves as an upsert in both cases. Returns the subscriber id.
export async function subscribeToForm(
  email: string,
  firstName?: string | null
): Promise<KitSubscriber | null> {
  const formId = getKitFormId();
  const payload: Record<string, unknown> = { email_address: email };
  if (firstName) payload.first_name = firstName;

  const path = formId ? `/forms/${formId}/subscribers` : `/subscribers`;
  const data = (await kitFetch(path, { method: "POST", body: payload })) as {
    subscriber?: KitSubscriber;
  } | null;
  return data?.subscriber ?? null;
}

export async function unsubscribe(subscriberId: number): Promise<void> {
  await kitFetch(`/subscribers/${subscriberId}/unsubscribe`, {
    method: "POST",
    body: {},
    tolerate: [404],
  });
}

export async function addTag(tagId: number, email: string): Promise<void> {
  await kitFetch(`/tags/${tagId}/subscribers`, {
    method: "POST",
    body: { email_address: email },
  });
}

export async function removeTag(
  tagId: number,
  subscriberId: number
): Promise<void> {
  await kitFetch(`/tags/${tagId}/subscribers/${subscriberId}`, {
    method: "DELETE",
    tolerate: [404],
  });
}

// Removes every configured supporter tag from a subscriber (used when a
// subscription is canceled so the active-tier tag set is cleared).
export async function clearSupporterTags(subscriberId: number): Promise<void> {
  for (const tagId of getAllKitTagIds()) {
    await removeTag(tagId, subscriberId);
  }
}

export interface KitPurchaseInput {
  email: string;
  firstName?: string | null;
  transactionId: string;
  amountCents: number;
  currency?: string;
  productName: string;
  // Stable product identifier; variants of the same product share a pid.
  productId: string;
  transactionTime?: string;
}

// Records a purchase against a subscriber for revenue/segmentation. This does
// not move money -- Stripe remains the processor. Purely a Kit tracking record.
export async function createPurchase(input: KitPurchaseInput): Promise<void> {
  const amount = input.amountCents / 100;
  await kitFetch(`/purchases`, {
    method: "POST",
    body: {
      email_address: input.email,
      ...(input.firstName ? { first_name: input.firstName } : {}),
      currency: (input.currency ?? "CAD").toUpperCase(),
      transaction_id: input.transactionId,
      transaction_time: input.transactionTime ?? new Date().toISOString(),
      status: "paid",
      subtotal: amount,
      total: amount,
      products: [
        {
          name: input.productName,
          pid: input.productId,
          lid: input.transactionId,
          unit_price: amount,
          quantity: 1,
        },
      ],
    },
    // Purchases must be unique by transaction_id; tolerate a re-send of the
    // same charge (e.g. duplicate webhook delivery).
    tolerate: [422],
  });
}
