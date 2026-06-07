import type { Market } from "@/lib/domain";
import { getFundGovernancePolicy } from "@/lib/agents/operating-policy";
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

export function classifyTradingUniversePod(market: Pick<Market, "ticker" | "sector" | "title" | "category">): string {
  return classifyTradingUniverseTicker(market.ticker, market.sector, market.title, market.category);
}

export function classifyTradingUniverseTicker(ticker: string, sector = "unclassified", title = "", category = ""): string {
  const text = `${ticker} ${title} ${category}`.toLowerCase();
  const normalizedSector = sector.toLowerCase();
  const normalizedCategory = category.toLowerCase();
  const rules = [...getFundGovernancePolicy().sectorClassificationRules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const rule of rules) {
    const textMatch = rule.matchAny.some((token) => policyTokenMatches(token, text));
    const sectorMatch = rule.sectorEquals?.some((token) => token.toLowerCase() === normalizedSector) ?? false;
    const categoryMatch = rule.categoryEquals?.some((token) => token.toLowerCase() === normalizedCategory) ?? false;
    if (textMatch || sectorMatch || categoryMatch) return rule.sector;
  }
  return `${sector}: general`;
}

export function selectDiverseMarketUniverse(markets: Market[], input: { limit: number; minPerPod: number }): Market[] {
  const ranked = [...markets].sort((a, b) => marketScanPriority(b) - marketScanPriority(a));
  const groups = new Map<string, Market[]>();
  for (const market of ranked) {
    const podKey = classifyTradingUniversePod(market);
    groups.set(podKey, [...(groups.get(podKey) ?? []), market]);
  }

  const selected = new Map<string, Market>();
  const podKeys = [...groups.entries()]
    .sort((a, b) => marketScanPriority(b[1][0]) - marketScanPriority(a[1][0]))
    .map(([podKey]) => podKey);

  for (let index = 0; index < input.minPerPod && selected.size < input.limit; index += 1) {
    for (const podKey of podKeys) {
      const market = groups.get(podKey)?.[index];
      if (market) selected.set(market.ticker, market);
      if (selected.size >= input.limit) break;
    }
  }

  for (const market of ranked) {
    if (selected.size >= input.limit) break;
    selected.set(market.ticker, market);
  }

  return [...selected.values()];
}

function policyTokenMatches(token: string, text: string): boolean {
  const normalized = token.toLowerCase();
  if (normalized.length <= 3) {
    const boundaryPattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`);
    return boundaryPattern.test(text) || text.includes(`kx${normalized}`);
  }
  return text.includes(normalized);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
