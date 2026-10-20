import { NextResponse } from "next/server";
import { cancelBatch } from "@/lib/youtube";
import { isSameLocalOrigin } from "@/lib/local-request";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameLocalOrigin(request)) return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  const { id } = await context.params;
  try {
    await cancelBatch(id);
    return NextResponse.json({ ok: true, id, status: "paused" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not cancel batch." }, { status: 400 });
  }
}
