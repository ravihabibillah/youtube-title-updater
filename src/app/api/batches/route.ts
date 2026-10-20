import { NextResponse } from "next/server";
import { z } from "zod";
import { createBatch } from "@/lib/youtube";
import { isSameLocalOrigin } from "@/lib/local-request";

export const runtime = "nodejs";
const bodySchema = z.object({ videoIds: z.array(z.object({ videoId: z.string().min(1), title: z.string().min(1).max(300) })).min(1).max(5000) });

export async function POST(request: Request) {
  if (!isSameLocalOrigin(request)) return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  try {
    const body = bodySchema.parse(await request.json());
    return NextResponse.json(await createBatch(body.videoIds));
  } catch (error) {
    const message = error instanceof z.ZodError ? "Invalid video selection." : error instanceof Error ? error.message : "Could not create batch.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
