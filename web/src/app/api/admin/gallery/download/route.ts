import { createServerClient } from "@/lib/supabase/server";
import { getUploadObject, isUploadConfigured } from "@/lib/r2";
import { verifyAdmin } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { Zip, ZipPassThrough } from "fflate";

// Node runtime: we stream large R2 objects (videos up to 4GB) through fflate's
// streaming zip, which relies on Node stream semantics.
export const runtime = "nodejs";

// Cap the number of items per bulk download to keep a single request bounded.
const MAX_ITEMS = 500;

function villagerName(
  villagers: { display_name: string } | { display_name: string }[] | null
): string {
  if (!villagers) return "Unknown";
  if (Array.isArray(villagers)) return villagers[0]?.display_name ?? "Unknown";
  return villagers.display_name;
}

function extFromKey(objectKey: string): string {
  const dot = objectKey.lastIndexOf(".");
  return dot !== -1 ? objectKey.slice(dot) : "";
}

// Mirror the client's filename scheme so downloaded zip entries match what a
// single-file download would produce.
function zipEntryName(displayName: string, id: string, objectKey: string): string {
  const safeName =
    displayName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "upload";
  return `${safeName}-${id.slice(0, 8)}${extFromKey(objectKey)}`;
}

// Ensure every entry name is unique inside the archive (two villagers can share
// a display name, which would otherwise collide).
function uniqueName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot !== -1 ? name.slice(0, dot) : name;
  const ext = dot !== -1 ? name.slice(dot) : "";
  let i = 2;
  let candidate = `${base}-${i}${ext}`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${base}-${i}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

// Bulk download the selected uploads as a single zip. Downloading N files via N
// programmatic anchor clicks is unreliable (browsers coalesce rapid downloads
// and typically only save the last one), so we bundle the exact selected set
// into one archive that the client saves in a single action.
export async function POST(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  if (!isUploadConfigured()) {
    return NextResponse.json({ error: "Upload storage not configured" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawIds =
    payload && typeof payload === "object" && "ids" in payload
      ? (payload as { ids: unknown }).ids
      : null;
  const ids = Array.isArray(rawIds)
    ? Array.from(new Set(rawIds.filter((v): v is string => typeof v === "string")))
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "No uploads selected" }, { status: 400 });
  }
  if (ids.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `Too many items selected (max ${MAX_ITEMS})` },
      { status: 400 }
    );
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("uploads")
    .select("id, object_key, content_type, villager_id, villagers!inner(display_name)")
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No matching uploads" }, { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });

      void (async () => {
        const usedNames = new Set<string>();
        try {
          for (const row of rows) {
            const object = await getUploadObject(row.object_key);
            if (!object) continue;

            const name = uniqueName(
              usedNames,
              zipEntryName(villagerName(row.villagers), row.id, row.object_key)
            );
            const entry = new ZipPassThrough(name);
            zip.add(entry);

            const reader = object.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.length > 0) entry.push(value, false);
            }
            entry.push(new Uint8Array(0), true);
          }
          zip.end();
        } catch (e) {
          controller.error(e);
        }
      })();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="village-gallery.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
