import type { Market, PortfolioSnapshot, Position } from "@/lib/domain";

export function eventClusterKey(market: Pick<Market, "eventTicker" | "ticker" | "sector">): string {
  const base = market.eventTicker?.trim() || eventClusterKeyFromTicker(market.ticker);
  return normalizeCluster(`${market.sector}:${base}`);
}

export function eventClusterKeyFromTicker(ticker: string, sector = "unknown"): string {
  const parts = ticker.split("-").filter(Boolean);
  if (parts.length >= 3) return normalizeCluster(`${sector}:${parts.slice(0, -1).join("-")}`);
  return normalizeCluster(`${sector}:${ticker}`);
}

export function positionEventClusterKey(position: Pick<Position, "ticker" | "sector">): string {
  return eventClusterKeyFromTicker(position.ticker, position.sector);
}

export function eventClusterExposure(input: {
  portfolio?: PortfolioSnapshot;
  market: Pick<Market, "eventTicker" | "ticker" | "sector">;
}): number {
  if (!input.portfolio) return 0;
  const cluster = eventClusterKey(input.market);
  return money(
    input.portfolio.positions
      .filter((position) => positionEventClusterKey(position) === cluster)
      .reduce((sum, position) => sum + position.avgCost * (position.yesContracts + position.noContracts), 0)
  );
}

function normalizeCluster(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function money(value: number): number {
  return Number(value.toFixed(2));
}
