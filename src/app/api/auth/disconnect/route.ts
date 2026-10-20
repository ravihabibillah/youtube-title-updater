import { NextResponse } from "next/server";
import { disconnectYouTube } from "@/lib/auth";
import { isSameLocalOrigin } from "@/lib/local-request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameLocalOrigin(request)) return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  await disconnectYouTube();
  return NextResponse.json({ ok: true });
}
