import type { Market } from "@/lib/domain";
import { boolEnv, getEnv, getKalshiMarketScanConfig, getPaperCycleConfig } from "@/lib/config/env";
import { KalshiClient } from "@/lib/kalshi/client";
import { demoMarkets } from "@/lib/data/seeds";
import { classifyTradingUniversePod, isExcludedTradingUniverseMarket, isPaperScanCandidate, selectDiverseMarketUniverse } from "@/lib/markets/universe";

type MarketServiceResult = {
  markets: Market[];
  source: "kalshi" | "demo";
  blocker?: string;
  rawMarketCount?: number;
  candidateMarketCount?: number;
  excludedMarketCount?: number;
  podCount?: number;
  cached?: boolean;
};

let marketCache: { expiresAt: number; result: MarketServiceResult } | undefined;
let pendingMarketScan: Promise<MarketServiceResult> | undefined;

export async function getMarkets(): Promise<MarketServiceResult> {
  const { cacheTtlMs } = getKalshiMarketScanConfig();
  const now = Date.now();
  if (marketCache && marketCache.expiresAt > now) {
    return { ...marketCache.result, cached: true };
  }
  if (pendingMarketScan) return pendingMarketScan;

  pendingMarketScan = fetchMarkets().then((result) => {
    if (cacheTtlMs > 0) {
      marketCache = { result, expiresAt: Date.now() + cacheTtlMs };
    }
    return result;
  }).finally(() => {
    pendingMarketScan = undefined;
  });

  return pendingMarketScan;
}

async function fetchMarkets(): Promise<MarketServiceResult> {
  const allowDemoMarkets = boolEnv(getEnv().ALLOW_DEMO_MARKETS);
  const client = new KalshiClient();
  try {
    const scanConfig = getKalshiMarketScanConfig();
    const markets = await client.listMarkets(scanConfig.scanLimit);
    const { minScanHorizonMs } = getPaperCycleConfig();
    const excludedMarketCount = markets.filter(isExcludedTradingUniverseMarket).length;
    const scanMarkets = markets.filter((market) => isPaperScanCandidate(market, minScanHorizonMs));
    const fallbackMarkets = markets.filter((market) => !isExcludedTradingUniverseMarket(market));
    const rankedMarkets = selectDiverseMarketUniverse(scanMarkets.length ? scanMarkets : fallbackMarkets, {
      limit: scanConfig.resultLimit,
      minPerPod: scanConfig.minPerPod
    });
    if (rankedMarkets.length > 0) {
      return {
        markets: rankedMarkets,
        source: "kalshi",
        rawMarketCount: markets.length,
        candidateMarketCount: scanMarkets.length,
        excludedMarketCount,
        podCount: new Set(rankedMarkets.map(classifyTradingUniversePod)).size
      };
    }
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
