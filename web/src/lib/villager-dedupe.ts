import { createServerClient } from "@/lib/supabase/server";
import { escapeLike } from "@/lib/subscription-sync";

type SupabaseClient = ReturnType<typeof createServerClient>;

// Normalizes an email for case-insensitive comparison and storage.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Normalizes an Instagram handle to a trimmed, lowercased, @-prefixed form
// (matches the onboarding form and recovery flow normalization).
export function normalizeIgHandle(handle: string): string {
  let normalized = handle.trim().toLowerCase();
  if (normalized && !normalized.startsWith("@")) {
    normalized = `@${normalized}`;
  }
  return normalized;
}

// Coerces a device_ids payload (an array, a single string, or a
// comma-separated string from the admin form) into a deduped string[].
export function normalizeDeviceIds(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const cleaned = raw
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

export type DuplicateField = "email" | "ig_handle";

// Returns which unique field (if any) already belongs to another villager.
// Email is checked before ig_handle. Pass excludeId to skip the row being
// edited so updating a villager doesn't conflict with itself.
export async function findDuplicateField(
  supabase: SupabaseClient,
  opts: { email?: string | null; igHandle?: string | null; excludeId?: string }
): Promise<DuplicateField | null> {
  if (opts.email) {
    let query = supabase
      .from("villagers")
      .select("id")
      .ilike("email", escapeLike(opts.email))
      .limit(1);
    if (opts.excludeId) query = query.neq("id", opts.excludeId);
    const { data } = await query;
    if (data?.length) return "email";
  }

  if (opts.igHandle) {
    let query = supabase
      .from("villagers")
      .select("id")
      .ilike("ig_handle", escapeLike(opts.igHandle))
      .limit(1);
    if (opts.excludeId) query = query.neq("id", opts.excludeId);
    const { data } = await query;
    if (data?.length) return "ig_handle";
  }

  return null;
}

const EMAIL_TAKEN = "That email is already registered.";
const IG_TAKEN = "That Instagram handle is already taken.";
const DEVICE_TAKEN = "Device already registered";

// Maps a Postgres unique-violation error (code 23505) to a friendly,
// field-specific message by inspecting the violated constraint name. Falls
// back to a generic duplicate message for unrecognized constraints.
export function uniqueViolationMessage(error: {
  code?: string;
  message?: string;
}): string {
  const detail = error.message ?? "";
  if (detail.includes("idx_villagers_email_unique")) return EMAIL_TAKEN;
  if (detail.includes("idx_villagers_ig_handle_unique")) return IG_TAKEN;
  // The device-uniqueness trigger raises "device_id already registered ...".
  if (detail.includes("device_id")) return DEVICE_TAKEN;
  return "That record already exists.";
}

export { EMAIL_TAKEN, IG_TAKEN };
