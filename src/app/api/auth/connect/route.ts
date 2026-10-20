import { NextResponse } from "next/server";
import { beginLocalOAuth } from "@/lib/auth";
import { isSameLocalOrigin } from "@/lib/local-request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameLocalOrigin(request)) return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  try {
    await beginLocalOAuth();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start Google sign-in." }, { status: 400 });
  }
}
