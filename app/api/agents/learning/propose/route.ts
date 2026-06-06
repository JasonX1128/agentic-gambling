import { NextRequest, NextResponse } from "next/server";
import { runAgentLearningLoop } from "@/lib/agents/learning";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  try {
    return NextResponse.json(await runAgentLearningLoop());
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "AGENT_LEARNING_BLOCKED",
        error: error instanceof Error ? error.message : String(error),
        remediation: ["Start Redis so policy learning proposals are queued and auditable."]
      },
      { status: 503 }
    );
  }
}
