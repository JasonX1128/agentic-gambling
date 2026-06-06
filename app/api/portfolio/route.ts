import { NextRequest, NextResponse } from "next/server";
import { getPortfolioSnapshot, markPortfolioToMarket } from "@/lib/portfolio/engine";
import { getMarkets } from "@/lib/services/market-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("mark") === "true") {
    const marketResult = await getMarkets();
    return NextResponse.json({
      portfolio: await markPortfolioToMarket(marketResult.markets),
      marketSource: marketResult.source,
      marketBlocker: marketResult.blocker
    });
  }
  return NextResponse.json(await getPortfolioSnapshot());
}
