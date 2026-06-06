import { NextResponse } from "next/server";
import { runDemoWorkflow } from "@/lib/agents/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(await runDemoWorkflow());
}
