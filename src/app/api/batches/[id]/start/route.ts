import { NextResponse } from "next/server";
import { runBatch } from "@/lib/youtube";
import { isSameLocalOrigin } from "@/lib/local-request";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameLocalOrigin(request)) return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  const { id } = await context.params;
  try {
    void runBatch(id).catch(() => undefined);
    return NextResponse.json({ ok: true, id, status: "running" }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start batch." }, { status: 400 });
  }
}
