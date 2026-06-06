import { NextRequest, NextResponse } from "next/server";
import { generateCioMemo } from "@/lib/agents/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { opportunityIds?: string[] };
  return NextResponse.json({ memo: await generateCioMemo(body.opportunityIds) });
}
