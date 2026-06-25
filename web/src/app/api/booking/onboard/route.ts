import { getInviteByToken, isInviteExpired } from "@/lib/booking-auth";
import { syncMarketingOptIn } from "@/lib/kit-sync";
import { EXCLUSIVE_ROLE, getExclusiveHandles, isHandleExclusive } from "@/lib/exclusive-tier";
import { createServerClient } from "@/lib/supabase/server";
import {
  EMAIL_TAKEN,
  IG_TAKEN,
  findDuplicateField,
  normalizeEmail,
  normalizeIgHandle,
  uniqueViolationMessage,
} from "@/lib/villager-dedupe";
import { Role } from "@/lib/tag-order";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    token,
    device_id,
    display_name,
    email,
    ig_handle,
    roles,
    instruments,
    marketing_opt_in,
  } = body;

  if (!token || !device_id || !display_name || !email) {
    return NextResponse.json(
      { error: "token, device_id, display_name, and email are required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();
  const invite = await getInviteByToken(supabase, token);

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  }

  if (invite.status === "expired" || isInviteExpired(invite)) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail !== normalizeEmail(invite.email)) {
    return NextResponse.json(
      { error: "Email must match the invite" },
      { status: 400 }
    );
  }

  const normalizedIg = ig_handle ? normalizeIgHandle(ig_handle) : "";

  const duplicate = await findDuplicateField(supabase, {
    email: normalizedEmail,
    igHandle: normalizedIg || null,
  });

  if (duplicate) {
    const { data: existing } = await supabase
      .from("villagers")
      .select("id, device_id, display_name, email, roles")
      .ilike("email", normalizedEmail)
      .single();

    if (existing) {
      await supabase
        .from("villagers")
        .update({ device_id })
        .eq("id", existing.id);

      await supabase
        .from("booking_invites")
        .update({ villager_id: existing.id, status: "accepted" })
        .eq("id", invite.id);

      return NextResponse.json({
        villager: { ...existing, device_id },
        linked: true,
      });
    }

    return NextResponse.json(
      { error: duplicate === "email" ? EMAIL_TAKEN : IG_TAKEN },
      { status: 409 }
    );
  }

  const finalRoles: string[] = Array.isArray(roles)
    ? roles.filter((r: unknown) => typeof r === "string" && r.toLowerCase() !== EXCLUSIVE_ROLE)
    : [Role.Producer];

  if (!finalRoles.includes(Role.Producer)) {
    finalRoles.unshift(Role.Producer);
  }

  if (normalizedIg) {
    const allowlist = await getExclusiveHandles(supabase);
    if (isHandleExclusive(normalizedIg, allowlist)) {
      finalRoles.push(EXCLUSIVE_ROLE);
    }
  }

  const record: Record<string, unknown> = {
    device_id,
    display_name: display_name.trim(),
    email: normalizedEmail,
    marketing_opt_in: marketing_opt_in === undefined ? true : Boolean(marketing_opt_in),
    roles: finalRoles,
  };
  if (normalizedIg) record.ig_handle = normalizedIg;
  if (instruments?.length) record.instruments = instruments;

  const { data, error } = await supabase
    .from("villagers")
    .insert(record)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: uniqueViolationMessage(error) },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase
    .from("booking_invites")
    .update({ villager_id: data.id, status: "accepted" })
    .eq("id", invite.id);

  const { kitSubscriberId } = await syncMarketingOptIn({
    email: normalizedEmail,
    firstName: display_name.trim(),
    optIn: Boolean(record.marketing_opt_in),
    kitSubscriberId: null,
  });
  if (kitSubscriberId) {
    await supabase
      .from("villagers")
      .update({ kit_subscriber_id: kitSubscriberId })
      .eq("id", data.id);
  }

  return NextResponse.json({ villager: data }, { status: 201 });
}
