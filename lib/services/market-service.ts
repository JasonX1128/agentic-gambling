import type { Market } from "@/lib/domain";
import { boolEnv, getEnv } from "@/lib/config/env";
import { KalshiClient } from "@/lib/kalshi/client";
import { demoMarkets } from "@/lib/data/seeds";

const MIN_SCAN_HORIZON_MS = 30 * 60 * 1000;

export async function getMarkets(): Promise<{ markets: Market[]; source: "kalshi" | "demo"; blocker?: string }> {
  const allowDemoMarkets = boolEnv(getEnv().ALLOW_DEMO_MARKETS);
  const client = new KalshiClient();
  try {
    const markets = await client.listMarkets(1000);
    const scanMarkets = markets.filter(isPaperScanCandidate);
    const rankedMarkets = (scanMarkets.length ? scanMarkets : markets)
      .sort((a, b) => b.liquidity + b.volume / 100 - (a.liquidity + a.volume / 100))
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

function isPaperScanCandidate(market: Market) {
  if (market.yesBid <= 0 || market.yesAsk <= 0) return false;
  if (market.yesAsk <= market.yesBid) return false;

  if (!market.closeTime) return true;
  const closeTime = Date.parse(market.closeTime);
  if (!Number.isFinite(closeTime)) return true;
  return closeTime - Date.now() >= MIN_SCAN_HORIZON_MS;
}
