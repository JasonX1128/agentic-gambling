import type { Market } from "@/lib/domain";
import { boolEnv, getEnv, getPaperCycleConfig } from "@/lib/config/env";
import { KalshiClient } from "@/lib/kalshi/client";
import { demoMarkets } from "@/lib/data/seeds";
import { resolutionUrgencyScore } from "@/lib/quant/scoring";

export async function getMarkets(): Promise<{ markets: Market[]; source: "kalshi" | "demo"; blocker?: string }> {
  const allowDemoMarkets = boolEnv(getEnv().ALLOW_DEMO_MARKETS);
  const client = new KalshiClient();
  try {
    const markets = await client.listMarkets(1000);
    const { minScanHorizonMs } = getPaperCycleConfig();
    const scanMarkets = markets.filter((market) => isPaperScanCandidate(market, minScanHorizonMs));
    const rankedMarkets = (scanMarkets.length ? scanMarkets : markets)
      .sort((a, b) => marketScanPriority(b) - marketScanPriority(a))
      .slice(0, 60);
    if (rankedMarkets.length > 0) return { markets: rankedMarkets, source: "kalshi" };
    if (allowDemoMarkets) {
      return { markets: demoMarkets, source: "demo", blocker: "Kalshi returned no open markets for the current query." };
    }
    return {
      markets: [],
      source: "kalshi",
      blocker: "Kalshi returned no open markets for the current query; demo fallback is disabled."
    };
  } catch (error) {
    const blocker = error instanceof Error ? error.message : String(error);
    if (allowDemoMarkets) {
      return {
        markets: demoMarkets,
        source: "demo",
        blocker
      };
    }
    return {
      markets: [],
      source: "kalshi",
      blocker: `${blocker}; demo fallback is disabled.`
    };
  }
}

function isPaperScanCandidate(market: Market, minScanHorizonMs: number) {
  if (market.yesBid <= 0 || market.yesAsk <= 0) return false;
  if (market.yesAsk <= market.yesBid) return false;

  if (!market.closeTime) return true;
  const closeTime = Date.parse(market.closeTime);
  if (!Number.isFinite(closeTime)) return true;
  return closeTime - Date.now() >= minScanHorizonMs;
}

function marketScanPriority(market: Market) {
  return market.liquidity + market.volume / 100 + resolutionUrgencyScore(market) * 750;
}
