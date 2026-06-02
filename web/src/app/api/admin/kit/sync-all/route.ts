import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { isKitConfigured } from "@/lib/kit";
import { syncMarketingOptIn } from "@/lib/kit-sync";

// Hundreds of sequential Kit calls; allow a long-running invocation.
export const maxDuration = 300;

// One-time backfill / reconciliation: walks every villager with an email and
// reconciles their Kit membership with their marketing_opt_in flag. Idempotent,
// so it is safe to run repeatedly (the ~600 already on Kit are upserts).
export async function POST(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  if (!isKitConfigured()) {
    return NextResponse.json(
      { error: "Kit is not configured (KIT_API_KEY missing)" },
      { status: 503 }
    );
  }

  const supabase = createServerClient();
  const { data: villagers, error } = await supabase
    .from("villagers")
    .select("id, email, display_name, marketing_opt_in, kit_subscriber_id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let subscribed = 0;
  let unsubscribed = 0;
  let skipped = 0;
  let failed = 0;

  for (const villager of villagers ?? []) {
    if (!villager.email) {
      skipped++;
      continue;
    }
    try {
      const { kitSubscriberId, ok } = await syncMarketingOptIn({
        email: villager.email,
        firstName: villager.display_name,
        optIn: Boolean(villager.marketing_opt_in),
        kitSubscriberId: villager.kit_subscriber_id ?? null,
      });
      if (!ok) {
        failed++;
        continue;
      }
      if (kitSubscriberId && kitSubscriberId !== villager.kit_subscriber_id) {
        await supabase
          .from("villagers")
          .update({ kit_subscriber_id: kitSubscriberId })
          .eq("id", villager.id);
      }
      if (villager.marketing_opt_in) subscribed++;
      else unsubscribed++;
    } catch (err) {
      console.error("[kit] sync-all failed for villager", villager.id, err);
      failed++;
    }
  }

  return NextResponse.json({
    total: villagers?.length ?? 0,
    subscribed,
    unsubscribed,
    skipped,
    failed,
  });
}
