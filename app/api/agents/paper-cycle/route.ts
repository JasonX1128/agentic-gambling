import { NextResponse } from "next/server";
import { runPaperCycle } from "@/lib/agents/paper-cycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await runPaperCycle());
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "PAPER_CYCLE_BLOCKED",
        error: error instanceof Error ? error.message : String(error),
        remediation: [
          "Start Redis before running agent paper cycles.",
          "Confirm Kalshi market data loads from /api/markets.",
          "docker run --name efos-redis-stack -p 6379:6379 -p 8001:8001 redis/redis-stack:latest"
        ]
      },
      { status: 503 }
    );
  }
}
