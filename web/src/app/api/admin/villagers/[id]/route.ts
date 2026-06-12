import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { syncMarketingOptIn } from "@/lib/kit-sync";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("villagers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ villager: data });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const supabase = createServerClient();

  const updates: Record<string, unknown> = {};
  const allowedFields = [
    "device_id",
    "display_name",
    "ig_handle",
    "roles",
    "instruments",
    "email",
    "marketing_opt_in",
    "test_account",
    "avatar_head",
    "avatar_body",
    "first_visited_at",
    "last_visited_at",
  ];

  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  const { data, error } = await supabase
    .from("villagers")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Mirror the opt-in choice into Kit whenever the admin touches the toggle
  // (or email). Non-blocking and idempotent.
  if ("marketing_opt_in" in body || "email" in body) {
    const { kitSubscriberId } = await syncMarketingOptIn({
      email: data.email,
      firstName: data.display_name,
      optIn: Boolean(data.marketing_opt_in),
      kitSubscriberId: data.kit_subscriber_id ?? null,
    });
    if (kitSubscriberId && kitSubscriberId !== data.kit_subscriber_id) {
      await supabase
        .from("villagers")
        .update({ kit_subscriber_id: kitSubscriberId })
        .eq("id", id);
      data.kit_subscriber_id = kitSubscriberId;
    }
  }

  return NextResponse.json({ villager: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const supabase = createServerClient();

  const { error } = await supabase.from("villagers").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
