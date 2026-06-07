import type { Market } from "@/lib/domain";
import { resolutionUrgencyScore } from "@/lib/quant/scoring";

const blockedTickerFragments = ["KXQUICKSETTLE"];
const blockedTitlePatterns = [
  /\b\d+\s*\+\s*\d+\s*=\s*\d+\b/i
];

export function isExcludedTradingUniverseMarket(
  market: Pick<Market, "ticker" | "eventTicker" | "title" | "ruleSummary">
): boolean {
  const tickerText = `${market.ticker} ${market.eventTicker ?? ""}`.toUpperCase();
  if (blockedTickerFragments.some((fragment) => tickerText.includes(fragment))) return true;

  const descriptionText = `${market.title} ${market.ruleSummary}`.trim();
  return blockedTitlePatterns.some((pattern) => pattern.test(descriptionText));
}

export function isPaperScanCandidate(market: Market, minScanHorizonMs: number, nowMs = Date.now()): boolean {
  if (isExcludedTradingUniverseMarket(market)) return false;
  if (market.yesBid <= 0 || market.yesAsk <= 0) return false;
  if (market.yesAsk <= market.yesBid) return false;

  if (!market.closeTime) return true;
  const closeTime = Date.parse(market.closeTime);
  if (!Number.isFinite(closeTime)) return true;
  return closeTime - nowMs >= minScanHorizonMs;
}

export function marketScanPriority(market: Market): number {
  return market.liquidity + market.volume / 100 + resolutionUrgencyScore(market) * 750;
}
