import { NextRequest, NextResponse } from "next/server";
import { runFundWorkersOnce } from "@/lib/agents/workers";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  try {
    return NextResponse.json(await runFundWorkersOnce());
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "REDIS_WORKER_RUN_FAILED",
        error: error instanceof Error ? error.message : String(error),
        remediation: ["Start Redis so Streams can be consumed by fund workers."]
      },
      { status: 503 }
    );
  }
}
