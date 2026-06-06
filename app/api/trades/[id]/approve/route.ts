import { NextRequest, NextResponse } from "next/server";
import { getOpportunities } from "@/lib/agents/orchestrator";
import { approvePaperTrade } from "@/lib/execution/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { source?: "agent" | "copilot" | "operator" | "demo" };
  const opportunity = (await getOpportunities()).find((item) => item.id === id);
  if (!opportunity) return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  try {
    return NextResponse.json(await approvePaperTrade(opportunity, body.source ?? "operator"));
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "REDIS_REQUIRED_FOR_PAPER_EXECUTION",
        error: error instanceof Error ? error.message : String(error),
        remediation: [
          "Start Redis before approving paper trades.",
          "docker run --name efos-redis-stack -p 6379:6379 -p 8001:8001 redis/redis-stack:latest"
        ]
      },
      { status: 503 }
    );
  }
}
