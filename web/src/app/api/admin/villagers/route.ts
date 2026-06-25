import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { syncMarketingOptIn } from "@/lib/kit-sync";
import { ACTIVE_STATUSES } from "@/lib/subscription-sync";
import {
  EMAIL_TAKEN,
  IG_TAKEN,
  findDuplicateField,
  normalizeEmail,
  normalizeIgHandle,
  uniqueViolationMessage,
} from "@/lib/villager-dedupe";

const VILLAGER_SELECT = "*, subscriptions(status, amount, interval, created_at)";

type JoinedSubscription = {
  status: string;
  amount: number;
  interval: string;
  created_at: string;
};

// Reduce a villager's subscription rows to a single at-a-glance summary:
// prefer an active pledge, otherwise fall back to the most recent row.
function summarizeSubscription(rows: JoinedSubscription[] | null | undefined) {
  if (!rows?.length) return null;

  const active = rows.find((s) => ACTIVE_STATUSES.has(s.status));
  const chosen =
    active ??
    [...rows].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

  return {
    status: chosen.status,
    amount: chosen.amount,
    interval: chosen.interval,
  };
}

// Drop the raw joined `subscriptions` array and attach the compact summary.
function withSubscriptionSummary(
  villager: Record<string, unknown> & { subscriptions?: JoinedSubscription[] }
) {
  const { subscriptions, ...rest } = villager;
  return { ...rest, subscription: summarizeSubscription(subscriptions) };
}

function maxLastVisitedAt(
  stored: string | null | undefined,
  fromCheckIns: string | undefined
): string | null {
  if (!fromCheckIns) return stored ?? null;
  if (!stored) return fromCheckIns;
  return new Date(fromCheckIns) > new Date(stored) ? fromCheckIns : stored;
}

async function lastVisitedAtByVillagerId(
  supabase: ReturnType<typeof createServerClient>,
  villagerIds: string[]
): Promise<Map<string, string>> {
  if (villagerIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("check_ins")
    .select("villager_id, created_at")
    .in("villager_id", villagerIds);

  if (error || !data) return new Map();

  const maxByVillager = new Map<string, string>();
  for (const row of data) {
    const existing = maxByVillager.get(row.villager_id);
    if (
      !existing ||
      new Date(row.created_at).getTime() > new Date(existing).getTime()
    ) {
      maxByVillager.set(row.villager_id, row.created_at);
    }
  }
  return maxByVillager;
}

export async function GET(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const supabase = createServerClient();
  const url = req.nextUrl;
  const search = url.searchParams.get("search") || "";
  const sortBy = url.searchParams.get("sort_by") || "first_visited_at";
  const sortDir = url.searchParams.get("sort_dir") === "asc" ? true : false;

  let query = supabase.from("villagers").select(VILLAGER_SELECT);

  if (search) {
    query = query.or(
      `display_name.ilike.%${search}%,email.ilike.%${search}%,ig_handle.ilike.%${search}%`
    );
  }

  const { data, error } = await query.order(sortBy, { ascending: sortDir });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (search && data) {
    const needle = search.toLowerCase();
    const { data: allData } = await supabase
      .from("villagers")
      .select(VILLAGER_SELECT)
      .order(sortBy, { ascending: sortDir });

    if (allData) {
      const existingIds = new Set(data.map((v) => v.id));
      const arrayMatches = allData.filter(
        (v) =>
          !existingIds.has(v.id) &&
          ((Array.isArray(v.instruments) &&
            v.instruments.some((inst: string) =>
              inst.toLowerCase().includes(needle)
            )) ||
            (Array.isArray(v.roles) &&
              v.roles.some((role: string) =>
                role.toLowerCase().includes(needle)
              )))
      );
      data.push(...arrayMatches);
    }
  }

  const rows = data ?? [];
  const lastVisitedMap = await lastVisitedAtByVillagerId(
    supabase,
    rows.map((v) => v.id)
  );

  const villagers = rows.map((v) => {
    const summary = withSubscriptionSummary(
      v as Record<string, unknown> & { subscriptions?: JoinedSubscription[] }
    );
    return {
      ...summary,
      last_visited_at: maxLastVisitedAt(
        v.last_visited_at,
        lastVisitedMap.get(v.id)
      ),
    };
  });

  return NextResponse.json({ villagers });
}

export async function POST(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const supabase = createServerClient();

  const normalizedEmail = body.email ? normalizeEmail(body.email) : null;
  const normalizedIg = body.ig_handle ? normalizeIgHandle(body.ig_handle) : null;

  const duplicate = await findDuplicateField(supabase, {
    email: normalizedEmail,
    igHandle: normalizedIg,
  });
  if (duplicate) {
    return NextResponse.json(
      { error: duplicate === "email" ? EMAIL_TAKEN : IG_TAKEN },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("villagers")
    .insert({
      device_id: body.device_id,
      display_name: body.display_name,
      ig_handle: normalizedIg,
      roles: body.roles ?? [],
      instruments: body.instruments ?? [],
      email: normalizedEmail,
      marketing_opt_in: body.marketing_opt_in ?? false,
      first_visited_at: body.first_visited_at || new Date().toISOString(),
      last_visited_at: body.last_visited_at || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: uniqueViolationMessage(error) },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (data.email) {
    const { kitSubscriberId } = await syncMarketingOptIn({
      email: data.email,
      firstName: data.display_name,
      optIn: Boolean(data.marketing_opt_in),
      kitSubscriberId: null,
    });
    if (kitSubscriberId) {
      await supabase
        .from("villagers")
        .update({ kit_subscriber_id: kitSubscriberId })
        .eq("id", data.id);
      data.kit_subscriber_id = kitSubscriberId;
    }
  }

  return NextResponse.json({ villager: data }, { status: 201 });
}
