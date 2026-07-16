import { createServerClient } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/villager-dedupe";

type SupabaseClient = ReturnType<typeof createServerClient>;

export interface BookingInviteRow {
  id: string;
  email: string;
  token: string;
  villager_id: string | null;
  status: string;
  expires_at: string;
}

export interface VillagerRow {
  id: string;
  device_id: string;
  display_name: string;
  email: string | null;
  roles: string[];
}

export async function getInviteByToken(
  supabase: SupabaseClient,
  token: string
): Promise<BookingInviteRow | null> {
  const { data } = await supabase
    .from("booking_invites")
    .select("id, email, token, villager_id, status, expires_at")
    .eq("token", token)
    .single();
  return data;
}

export function isInviteExpired(invite: BookingInviteRow): boolean {
  return new Date(invite.expires_at) < new Date();
}

export async function resolveInviteVillager(
  supabase: SupabaseClient,
  invite: BookingInviteRow
): Promise<string | null> {
  if (invite.villager_id) return invite.villager_id;

  const email = normalizeEmail(invite.email);
  const { data: villager } = await supabase
    .from("villagers")
    .select("id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (!villager) return null;

  await supabase
    .from("booking_invites")
    .update({ villager_id: villager.id, status: "accepted" })
    .eq("id", invite.id);

  return villager.id;
}

export async function validateProducerAccess(
  supabase: SupabaseClient,
  token: string,
  deviceId: string
): Promise<
  | { ok: true; invite: BookingInviteRow; villager: VillagerRow }
  | { ok: false; error: string; status: number }
> {
  if (!token || !deviceId) {
    return { ok: false, error: "token and device_id are required", status: 400 };
  }

  const invite = await getInviteByToken(supabase, token);
  if (!invite) {
    return { ok: false, error: "Invalid invite link", status: 404 };
  }

  if (invite.status === "expired" || isInviteExpired(invite)) {
    if (invite.status !== "expired") {
      await supabase.from("booking_invites").update({ status: "expired" }).eq("id", invite.id);
    }
    return { ok: false, error: "This invite has expired", status: 410 };
  }

  const villagerId = await resolveInviteVillager(supabase, invite);
  if (!villagerId) {
    return { ok: false, error: "Onboarding required", status: 403 };
  }

  const { data: villager } = await supabase
    .from("villagers")
    .select("id, device_id, display_name, email, roles")
    .eq("id", villagerId)
    .single();

  if (!villager) {
    return { ok: false, error: "Villager not found", status: 404 };
  }

  if (villager.device_id !== deviceId) {
    return { ok: false, error: "Device mismatch", status: 403 };
  }

  return { ok: true, invite, villager };
}

export function generateInviteToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}
