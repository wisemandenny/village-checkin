import { getSelfieObject } from "@/lib/r2";
import { NextResponse } from "next/server";

// Public read proxy for villager selfies. The R2 bucket is private; this route
// streams the object back so the "who's here" board can show it without a public
// bucket or custom domain. Only well-formed "<id>.<ext>" filenames are allowed,
// which keeps the lookup confined to the selfies/ prefix.
const FILE_RE = /^[a-zA-Z0-9-]+\.(jpg|png|webp)$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  if (!FILE_RE.test(file)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const object = await getSelfieObject(file);
  if (!object) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(object.body, {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
