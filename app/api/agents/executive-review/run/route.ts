import { NextRequest, NextResponse } from "next/server";
import { runExecutiveCommitteeReview } from "@/lib/agents/executive-committee";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  try {
    return NextResponse.json(await runExecutiveCommitteeReview());
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "EXECUTIVE_REVIEW_FAILED",
        error: error instanceof Error ? error.message : String(error),
        remediation: ["Start Redis so executive committee actions can be queued and audited."]
      },
      { status: 503 }
    );
  }
}
