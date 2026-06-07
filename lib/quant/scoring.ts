import type { Forecast, Market } from "@/lib/domain";

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function marketImpliedProbability(market: Market): number {
  const midpoint = Number.isFinite(market.yesBid + market.yesAsk)
    ? (market.yesBid + market.yesAsk) / 2 / 100
    : market.lastPrice / 100;
  return clamp(midpoint);
}

export function liquidityQuality(market: Market): number {
  const spread = Math.max(0, market.yesAsk - market.yesBid);
  const depthScore = clamp(market.liquidity / 2000);
  const spreadPenalty = clamp(spread / 15);
  return clamp(depthScore * (1 - spreadPenalty));
}

export function hoursUntilClose(market: Pick<Market, "closeTime">, now = new Date()): number | undefined {
  if (!market.closeTime) return undefined;
  const closeTime = Date.parse(market.closeTime);
  if (!Number.isFinite(closeTime)) return undefined;
  return (closeTime - now.getTime()) / (60 * 60 * 1000);
}

export function resolutionUrgencyScore(market: Pick<Market, "closeTime">, now = new Date()): number {
  const hours = hoursUntilClose(market, now);
  if (hours === undefined || hours <= 0) return 0;
  if (hours <= 1) return 0.55;
  if (hours <= 6) return 1;
  if (hours <= 24) return 0.85;
  if (hours <= 72) return 0.6;
  if (hours <= 168) return 0.35;
  return 0.08;
}

export function expectedValue(fairProbability: number, entryPrice: number): number {
  return fairProbability - entryPrice;
}

export function calibrationBucket(probability: number): string {
  const lo = Math.floor(clamp(probability) * 10) / 10;
  return `${lo.toFixed(1)}-${Math.min(1, lo + 0.1).toFixed(1)}`;
}

export function brierScore(probability: number, actual: boolean): number {
  return Math.pow(clamp(probability) - (actual ? 1 : 0), 2);
}

export function cappedFractionalKelly(input: {
  probability: number;
  price: number;
  bankroll: number;
  fraction: number;
  cap: number;
}): number {
  const p = clamp(input.probability);
  const price = clamp(input.price, 0.01, 0.99);
  const b = (1 - price) / price;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  const notional = Math.max(0, kelly) * input.fraction * input.bankroll;
  return Math.min(input.cap, notional);
}

export function computeForecast(market: Market, fairProbability: number): Forecast {
  const marketProbability = marketImpliedProbability(market);
  const liquidity = liquidityQuality(market);
  const ev = expectedValue(clamp(fairProbability), marketProbability);
  const confidence = clamp(0.48 + Math.abs(ev) * 1.4 + liquidity * 0.18);
  const uncertainty = clamp(1 - confidence);
  const downside = clamp(marketProbability * (1 - liquidity));
  return {
    marketId: market.id,
    marketProbability,
    fairProbability: clamp(fairProbability),
    expectedValue: ev,
    confidence,
    liquidityQuality: liquidity,
    uncertainty,
    downside,
    calibrationBucket: calibrationBucket(fairProbability)
  };
}
