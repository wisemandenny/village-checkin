import {
  findSubscriberByEmail,
  isKitConfigured,
  subscribeToForm,
  unsubscribe,
} from "./kit";

// Reconciles a villager's mailing-list membership with their opt-in flag.
// Opted in -> subscribe to the Kit Form (upsert). Opted out -> unsubscribe.
// Returns the Kit subscriber id to persist (unchanged on unsubscribe) and an
// `ok` flag. Never throws: Kit being unreachable must not break the caller.
export async function syncMarketingOptIn(params: {
  email: string | null;
  firstName?: string | null;
  optIn: boolean;
  kitSubscriberId: string | null;
}): Promise<{ kitSubscriberId: string | null; ok: boolean }> {
  const { email, firstName, optIn, kitSubscriberId } = params;

  // Not configured / no email is a no-op success, not a failure.
  if (!isKitConfigured() || !email) {
    return { kitSubscriberId, ok: true };
  }

  try {
    if (optIn) {
      const subscriber = await subscribeToForm(email, firstName);
      return {
        kitSubscriberId: subscriber ? String(subscriber.id) : kitSubscriberId,
        ok: true,
      };
    }

    let id = kitSubscriberId ? Number(kitSubscriberId) : null;
    if (!id) {
      const existing = await findSubscriberByEmail(email);
      id = existing?.id ?? null;
    }
    if (id) await unsubscribe(id);
    return { kitSubscriberId, ok: true };
  } catch (err) {
    console.error("[kit] syncMarketingOptIn failed", err);
    return { kitSubscriberId, ok: false };
  }
}
