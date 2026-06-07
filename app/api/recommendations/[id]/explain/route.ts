import { NextRequest, NextResponse } from "next/server";
import { explainOpportunity, getOpportunities } from "@/lib/agents/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opportunity = (await getOpportunities()).find((item) => item.id === id);
  if (!opportunity) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
  return NextResponse.json({
    id,
    explanation: explainOpportunity(opportunity),
    thesis: opportunity.thesis,
    debate: opportunity.debate,
    browserResearch: opportunity.browserResearch,
    risk: opportunity.risk,
    compliance: opportunity.compliance
  });
}
