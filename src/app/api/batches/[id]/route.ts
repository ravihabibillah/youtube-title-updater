import { NextResponse } from "next/server";
import { getBatchState } from "@/lib/youtube";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = await getBatchState();
  if (!state.batch || state.batch.id !== id) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  return NextResponse.json(state.batch);
}
