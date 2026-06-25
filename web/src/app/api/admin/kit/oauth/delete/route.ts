import { verifyAdmin } from "@/lib/admin-auth";
import { appEnv } from "@/lib/app-env";
import { deleteStoredTokens } from "@/lib/kit-oauth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const denied = await verifyAdmin(req);
  if (denied) return denied;

  if (appEnv() !== "staging") {
    return NextResponse.json({ error: "Not available in this environment" }, { status: 403 });
  }

  try {
    await deleteStoredTokens();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete tokens";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
