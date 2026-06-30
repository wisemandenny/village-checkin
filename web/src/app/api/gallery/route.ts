import { createServerClient } from "@/lib/supabase/server";
import { isUploadConfigured, presignDownloadUrl } from "@/lib/r2";
import { NextRequest, NextResponse } from "next/server";

const GALLERY_LIMIT = 60;
// How many items the payment-screen mosaic fetches. Kept small: these load
// inline on a high-traffic screen, and the mosaic only renders a handful.
const MOSAIC_LIMIT = 12;

const MOSAIC_SELECT =
  "id, kind, content_type, object_key, created_at, promoted_at, villager_id, villagers!inner(display_name)";
const FEED_SELECT =
  "id, kind, content_type, object_key, created_at, villager_id, villagers!inner(display_name)";

interface UploadRow {
  id: string;
  kind: "photo" | "video";
  content_type: string;
  object_key: string;
  created_at: string;
  promoted_at?: string | null;
  villager_id: string;
  villagers: { display_name: string } | { display_name: string }[] | null;
}

function villagerName(
  villagers: { display_name: string } | { display_name: string }[] | null
): string {
  if (!villagers) return "Unknown";
  if (Array.isArray(villagers)) return villagers[0]?.display_name ?? "Unknown";
  return villagers.display_name;
}

// Presign each row's media; drop any whose presign fails. `promoted` is derived
// from promoted_at so the mosaic can assign highlighted tiles client-side.
async function presignRows(rows: UploadRow[]) {
  return (
    await Promise.all(
      rows.map(async (row) => {
        const url = await presignDownloadUrl(row.object_key, row.content_type);
        if (!url) return null;
        return {
          id: row.id,
          kind: row.kind,
          url,
          display_name: villagerName(row.villagers),
          villager_id: row.villager_id,
          created_at: row.created_at,
          promoted: row.promoted_at != null,
        };
      })
    )
  ).filter((u): u is NonNullable<typeof u> => u != null);
}

export async function GET(req: NextRequest) {
  if (!isUploadConfigured()) {
    return NextResponse.json({ configured: false, uploads: [] });
  }

  const supabase = createServerClient();
  const scope = req.nextUrl.searchParams.get("scope");

  if (scope === "mosaic") {
    // Two filtered queries (both exclude reported + soft-deleted), merged so
    // promoted items are never windowed out: promoted-first (newest promotion),
    // then recency fills the rest. Recency naturally prefers today's uploads and
    // backfills with older ones.
    const base = () =>
      supabase
        .from("uploads")
        .select(MOSAIC_SELECT)
        .is("deleted_at", null)
        .eq("reported", false);

    const [recentRes, promotedRes] = await Promise.all([
      base().order("created_at", { ascending: false }).limit(MOSAIC_LIMIT),
      base()
        .not("promoted_at", "is", null)
        .order("promoted_at", { ascending: false })
        .limit(MOSAIC_LIMIT),
    ]);

    if (recentRes.error || promotedRes.error) {
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }

    const merged: UploadRow[] = [];
    const seen = new Set<string>();
    for (const row of [
      ...((promotedRes.data ?? []) as unknown as UploadRow[]),
      ...((recentRes.data ?? []) as unknown as UploadRow[]),
    ]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
      if (merged.length >= MOSAIC_LIMIT) break;
    }

    const uploads = await presignRows(merged);
    return NextResponse.json({ configured: true, uploads });
  }

  const { data, error } = await supabase
    .from("uploads")
    .select(FEED_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(GALLERY_LIMIT);

  if (error) {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  const uploads = await presignRows((data ?? []) as unknown as UploadRow[]);
  return NextResponse.json({ configured: true, uploads });
}
