import { NextRequest, NextResponse } from "next/server";
import { getOpportunities } from "@/lib/agents/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const minConfidence = Number(params.get("minConfidence") ?? 0);
  const minLiquidity = Number(params.get("minLiquidity") ?? 0);
  const sector = params.get("sector");
  const includeBlocked = params.get("includeBlocked") === "true";
  const opportunities = (await getOpportunities()).filter((opportunity) => {
    if (!includeBlocked && (!opportunity.risk.approved || !opportunity.compliance.approved)) return false;
    if (sector && opportunity.sector !== sector) return false;
    if (opportunity.forecast.confidence < minConfidence) return false;
    if (opportunity.market.liquidity < minLiquidity) return false;
    return true;
  });
  return NextResponse.json({ opportunities });
}
