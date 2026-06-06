import { NextRequest, NextResponse } from "next/server";
import { getMarkets } from "@/lib/services/market-service";
import { markPortfolioToMarket } from "@/lib/portfolio/engine";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  const marketResult = await getMarkets();
  const portfolio = await markPortfolioToMarket(marketResult.markets);
  return NextResponse.json({
    portfolio,
    marketSource: marketResult.source,
    marketBlocker: marketResult.blocker
  });
}
