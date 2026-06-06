import { NextRequest, NextResponse } from "next/server";
import { reconcilePaperSettlements } from "@/lib/agents/reconciliation";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  try {
    return NextResponse.json(await reconcilePaperSettlements());
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "PAPER_RECONCILIATION_FAILED",
        error: error instanceof Error ? error.message : String(error),
        remediation: ["Start Redis and confirm Kalshi market detail endpoints are reachable."]
      },
      { status: 503 }
    );
  }
}
