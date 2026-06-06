import { NextRequest, NextResponse } from "next/server";
import { getOpportunities } from "@/lib/agents/orchestrator";
import { executeLiveTrade } from "@/lib/execution/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { approvalToken?: string };
  const opportunity = (await getOpportunities()).find((item) => item.id === id);
  if (!opportunity) return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  const result = await executeLiveTrade(opportunity, body.approvalToken);
  return NextResponse.json(result, { status: result.blocked ? 403 : 200 });
}
