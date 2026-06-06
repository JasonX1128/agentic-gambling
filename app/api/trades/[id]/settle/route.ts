import { NextRequest, NextResponse } from "next/server";
import { settlePaperTrade } from "@/lib/execution/engine";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    outcome?: "yes" | "no";
    source?: "agent" | "copilot" | "operator" | "demo";
    notes?: string;
  };
  if (body.outcome !== "yes" && body.outcome !== "no") {
    return NextResponse.json(
      {
        blocked: true,
        code: "OUTCOME_REQUIRED",
        error: "Set outcome to yes or no."
      },
      { status: 400 }
    );
  }
  try {
    const result = await settlePaperTrade({
      ticker: id,
      outcome: body.outcome,
      source: body.source ?? "operator",
      notes: body.notes
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "PAPER_SETTLEMENT_FAILED",
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }
}
