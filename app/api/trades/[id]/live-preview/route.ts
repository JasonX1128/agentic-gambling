import { NextRequest, NextResponse } from "next/server";
import { getOpportunities } from "@/lib/agents/orchestrator";
import { previewLiveTrade } from "@/lib/execution/engine";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  const { id } = await params;
  const opportunity = (await getOpportunities()).find((item) => item.id === id);
  if (!opportunity) return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  try {
    const preview = await previewLiveTrade(opportunity);
    return NextResponse.json(preview, { status: preview.blocked ? 403 : 200 });
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "LIVE_PREVIEW_REDIS_REQUIRED",
        error: error instanceof Error ? error.message : String(error),
        remediation: ["Start Redis before live previews so operator audit logs and alerts are durable."]
      },
      { status: 503 }
    );
  }
}
