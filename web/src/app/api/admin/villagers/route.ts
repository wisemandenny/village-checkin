import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { syncMarketingOptIn } from "@/lib/kit-sync";

export async function GET(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const supabase = createServerClient();
  const url = req.nextUrl;
  const search = url.searchParams.get("search") || "";
  const sortBy = url.searchParams.get("sort_by") || "first_visited_at";
  const sortDir = url.searchParams.get("sort_dir") === "asc" ? true : false;

  let query = supabase.from("villagers").select("*");

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
      .select("*")
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

  return NextResponse.json({ villagers: data });
}

export async function POST(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("villagers")
    .insert({
      device_id: body.device_id,
      display_name: body.display_name,
      ig_handle: body.ig_handle || null,
      roles: body.roles ?? [],
      instruments: body.instruments ?? [],
      email: body.email || null,
      marketing_opt_in: body.marketing_opt_in ?? false,
      first_visited_at: body.first_visited_at || new Date().toISOString(),
      last_visited_at: body.last_visited_at || null,
    })
    .select()
    .single();

  if (error) {
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
