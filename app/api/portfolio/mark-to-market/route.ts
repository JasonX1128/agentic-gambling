import { NextResponse } from "next/server";
import { getMarkets } from "@/lib/services/market-service";
import { markPortfolioToMarket } from "@/lib/portfolio/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const marketResult = await getMarkets();
  const portfolio = await markPortfolioToMarket(marketResult.markets);
  return NextResponse.json({
    portfolio,
    marketSource: marketResult.source,
    marketBlocker: marketResult.blocker
  });
}
