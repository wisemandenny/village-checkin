import { NextResponse } from "next/server";

// Recurring pledge amounts are fixed per tier (exclusive: $10/month plus the
// processing fee; standard: $5/week) and can no longer be self-edited, so this
// endpoint rejects all amount changes.
export async function POST() {
  return NextResponse.json(
    { error: "Your support amount is fixed and can't be changed" },
    { status: 400 }
  );
}
