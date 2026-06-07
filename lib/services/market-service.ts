import type { Market } from "@/lib/domain";
import { boolEnv, getEnv, getPaperCycleConfig } from "@/lib/config/env";
import { KalshiClient } from "@/lib/kalshi/client";
import { demoMarkets } from "@/lib/data/seeds";
import { isPaperScanCandidate, marketScanPriority } from "@/lib/markets/universe";

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
