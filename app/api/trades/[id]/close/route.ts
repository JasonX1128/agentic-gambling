import { NextRequest, NextResponse } from "next/server";
import { closePaperTrade } from "@/lib/execution/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    exitPrice?: number;
    quantity?: number;
    source?: "agent" | "copilot" | "operator" | "demo";
    reason?: string;
  };
  try {
    const result = await closePaperTrade({
      ticker: id,
      exitPrice: body.exitPrice,
      quantity: body.quantity,
      source: body.source ?? "operator",
      reason: body.reason
    });
    return NextResponse.json(result, { status: result.blocked ? 404 : 200 });
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "PAPER_CLOSE_FAILED",
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }
}
