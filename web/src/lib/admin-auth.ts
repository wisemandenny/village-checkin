import { NextRequest, NextResponse } from "next/server";

export function verifyAdmin(req: NextRequest): NextResponse | null {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    return NextResponse.json(
      { error: "Admin access is not configured" },
      { status: 503 }
    );
  }

  if (token !== password) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
