import { NextRequest, NextResponse } from "next/server";
import { runPaperTradingDaemonTick } from "@/lib/agents/daemon";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  try {
    const result = await runPaperTradingDaemonTick();
    return NextResponse.json(result, { status: result.locked ? 200 : 409 });
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "PAPER_DAEMON_TICK_FAILED",
        error: error instanceof Error ? error.message : String(error),
        remediation: [
          "Start Redis before running the continuous paper daemon.",
          "Confirm Kalshi market data loads from /api/markets.",
          "docker run --name efos-redis-stack -p 6379:6379 -p 8001:8001 redis/redis-stack:latest"
        ]
      },
      { status: 503 }
    );
  }
}
