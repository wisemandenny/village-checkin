import { createServerClient } from "@/lib/supabase/server";
import { isUploadConfigured, presignDownloadUrl } from "@/lib/r2";
import { verifyAdmin } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";

function villagerName(
  villagers: { display_name: string } | { display_name: string }[] | null
): string {
  if (!villagers) return "Unknown";
  if (Array.isArray(villagers)) return villagers[0]?.display_name ?? "Unknown";
  return villagers.display_name;
}

export async function GET(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  if (!isUploadConfigured()) {
    return NextResponse.json({ configured: false, uploads: [] });
  }

  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("uploads")
    .select(
      "id, kind, content_type, object_key, size_bytes, reported, promoted_at, created_at, deleted_at, deleted_by, villager_id, villagers!inner(display_name)"
    )
    .order("reported", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
          size_bytes: row.size_bytes,
          reported: row.reported,
          promoted_at: row.promoted_at,
          created_at: row.created_at,
          deleted_at: row.deleted_at,
          deleted_by: row.deleted_by,
        };
      })
    )
  ).filter((u): u is NonNullable<typeof u> => u != null);

  return NextResponse.json({ configured: true, uploads });
}
