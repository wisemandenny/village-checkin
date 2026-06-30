import { createServerClient } from "@/lib/supabase/server";
import { isUploadConfigured, presignDownloadUrl } from "@/lib/r2";
import { NextResponse } from "next/server";

const GALLERY_LIMIT = 60;

function villagerName(
  villagers: { display_name: string } | { display_name: string }[] | null
): string {
  if (!villagers) return "Unknown";
  if (Array.isArray(villagers)) return villagers[0]?.display_name ?? "Unknown";
  return villagers.display_name;
}

export async function GET() {
  const configured = isUploadConfigured();

  if (!configured) {
    return NextResponse.json({ configured: false, uploads: [] });
  }

  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("uploads")
    .select(
      "id, kind, content_type, object_key, created_at, villager_id, villagers!inner(display_name)"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(GALLERY_LIMIT);

  if (error) {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  const uploads = (
    await Promise.all(
      (data ?? []).map(async (row) => {
        const url = await presignDownloadUrl(row.object_key, row.content_type);
        if (!url) return null;
        return {
          id: row.id,
          kind: row.kind,
          url,
          display_name: villagerName(row.villagers),
          villager_id: row.villager_id,
          created_at: row.created_at,
        };
      })
    )
  ).filter((u): u is NonNullable<typeof u> => u != null);

  return NextResponse.json({ configured: true, uploads });
}
