import { NextResponse } from "next/server";
import { buildFundOperatingState } from "@/lib/agents/fund-management";
import { buildDemoOpportunities } from "@/lib/data/seeds";
import { markPortfolioToMarket } from "@/lib/portfolio/engine";
import { getMarkets } from "@/lib/services/market-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const marketResult = await getMarkets();
  const portfolio = await markPortfolioToMarket(marketResult.markets);
  const opportunities = buildDemoOpportunities(marketResult.markets, portfolio);
  const governance = buildFundOperatingState({ markets: marketResult.markets, opportunities, portfolio });
  return NextResponse.json({
    ...governance,
    marketSource: marketResult.source,
    marketBlocker: marketResult.blocker,
    portfolio
  });
}
