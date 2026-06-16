import { NextRequest, NextResponse } from "next/server";

// Proxies + caches Pokemon Infinite Fusion sprites from the community jsDelivr
// CDN. Centralizing this lets us cache, hide the upstream, and fall back when a
// specific fusion has no custom sprite (so an avatar never renders broken).

const CDN = "https://cdn.jsdelivr.net/gh/genfusion8/infinite-fusion-graphics@main/custom";

// Cache aggressively: a given fusion sprite is effectively immutable.
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
};

function parseId(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1025) return null;
  return n;
}

async function fetchSprite(head: number, body: number): Promise<Response | null> {
  const res = await fetch(`${CDN}/${head}.${body}.png`, {
    next: { revalidate: 604800 },
  });
  return res.ok ? res : null;
}

export async function GET(req: NextRequest) {
  const head = parseId(req.nextUrl.searchParams.get("head"));
  const body = parseId(req.nextUrl.searchParams.get("body"));

  if (head === null || body === null) {
    return NextResponse.json(
      { error: "head and body must be integers between 1 and 1025" },
      { status: 400 }
    );
  }

  // Requested fusion, then fall back to the head's self-fusion so the tile
  // still shows something recognizable rather than breaking.
  const upstream =
    (await fetchSprite(head, body)) ??
    (head !== body ? await fetchSprite(head, head) : null);

  if (!upstream) {
    // Let the client's onError placeholder take over.
    return new NextResponse(null, { status: 404 });
  }

  const buffer = await upstream.arrayBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
      ...CACHE_HEADERS,
    },
  });
}
