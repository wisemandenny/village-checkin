import { createServerClient } from "@/lib/supabase/server";

type SupabaseClient = ReturnType<typeof createServerClient>;

// Role granted to villagers eligible for the exclusive ($10/month support plus
// the card processing fee) tier.
export const EXCLUSIVE_ROLE = "exclusive";

// studio_settings key holding the permanent allowlist of eligible IG handles.
const SETTINGS_KEY = "exclusive_handles";

// Normalizes an IG handle to lowercase, "@"-prefixed form so matching is stable
// regardless of how it was entered. Returns null for blank input.
export function normalizeHandle(raw: string): string | null {
  let handle = raw.trim().toLowerCase();
  if (!handle) return null;
  if (!handle.startsWith("@")) handle = `@${handle}`;
  return handle === "@" ? null : handle;
}

// Parses a newline/comma-separated block of handles into a normalized,
// de-duplicated list (admin textarea input).
export function parseHandlesText(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/[\n,]/)) {
    const normalized = normalizeHandle(line);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

export async function getExclusiveHandles(
  supabase: SupabaseClient
): Promise<string[]> {
  const { data } = await supabase
    .from("studio_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();

  const value = data?.value;
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

export async function setExclusiveHandles(
  supabase: SupabaseClient,
  handles: string[]
): Promise<void> {
  await supabase
    .from("studio_settings")
    .upsert({ key: SETTINGS_KEY, value: handles }, { onConflict: "key" });
}

export function isHandleExclusive(
  handle: string | null | undefined,
  handles: string[]
): boolean {
  if (!handle) return false;
  const normalized = normalizeHandle(handle);
  return normalized ? handles.includes(normalized) : false;
}

interface VillagerRoleRow {
  id: string;
  ig_handle: string | null;
  roles: string[] | null;
}

// Returns whether a villager is in the exclusive tier — true if they already
// carry the role, or if their handle is on the permanent allowlist. In the
// latter case the role is persisted so it sticks and surfaces in admin.
export async function resolveExclusive(
  supabase: SupabaseClient,
  villager: VillagerRoleRow,
  handles?: string[]
): Promise<boolean> {
  const roles = villager.roles ?? [];
  if (roles.includes(EXCLUSIVE_ROLE)) return true;

  const allowlist = handles ?? (await getExclusiveHandles(supabase));
  if (!isHandleExclusive(villager.ig_handle, allowlist)) return false;

  await supabase
    .from("villagers")
    .update({ roles: [...roles, EXCLUSIVE_ROLE] })
    .eq("id", villager.id);
  return true;
}
