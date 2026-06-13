import { createServerClient } from "@/lib/supabase/server";
import { escapeLike } from "@/lib/subscription-sync";
import { NextRequest, NextResponse } from "next/server";

// Minimum typed characters (ignoring a leading "@") before we surface
// suggestions. Gates bulk enumeration of registered handles.
const MIN_PREFIX = 2;
const MAX_RESULTS = 5;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("q") ?? "";
  let prefix = raw.trim().toLowerCase();
  if (prefix.startsWith("@")) prefix = prefix.slice(1);

  if (prefix.length < MIN_PREFIX) {
    return NextResponse.json({ handles: [] });
  }

  const supabase = createServerClient();

  // Stored handles are always "@"-prefixed (see normalizeIgHandle), so match a
  // prefix pattern against the leading "@".
  const safe = escapeLike(prefix);
  const { data, error } = await supabase
    .from("villagers")
    .select("ig_handle")
    .ilike("ig_handle", `@${safe}%`)
    .not("ig_handle", "is", null)
    .order("ig_handle", { ascending: true })
    .limit(MAX_RESULTS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    handles: (data ?? []).map((v) => v.ig_handle),
  });
}
