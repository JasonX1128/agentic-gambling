import { NextRequest, NextResponse } from "next/server";
import { KalshiClient } from "@/lib/kalshi/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const depth = Number(req.nextUrl.searchParams.get("depth") ?? 10);
  try {
    const book = await new KalshiClient().getOrderBook(ticker, depth);
    return NextResponse.json(book);
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "KALSHI_ORDERBOOK_UNAVAILABLE",
        error: error instanceof Error ? error.message : String(error),
        required: ["KALSHI_API_KEY", "KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH"]
      },
      { status: 503 }
    );
  }
}
