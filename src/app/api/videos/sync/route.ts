import { NextResponse } from "next/server";
import { saveVideoInventory } from "@/lib/youtube";
import { youtubeErrorMessage } from "@/lib/youtube-errors";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await saveVideoInventory());
  } catch (error) {
    return NextResponse.json({ error: youtubeErrorMessage(error) }, { status: 400 });
  }
}
