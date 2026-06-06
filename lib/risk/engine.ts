import type { Forecast, Market, PortfolioSnapshot, RiskDecision, RiskLimits } from "@/lib/domain";
import { cappedFractionalKelly } from "@/lib/quant/scoring";

export type RiskInput = {
  market: Market;
  forecast: Forecast;
  requestedNotional: number;
  portfolio?: PortfolioSnapshot;
};

export function evaluateRisk(input: RiskInput, limits: RiskLimits): RiskDecision {
  const reasons: string[] = [];
  const blockedBy: string[] = [];
  const portfolio = input.portfolio;
  const sectorExposure = portfolio?.sectorExposure[input.market.sector] ?? 0;
  const openOrders = portfolio?.orders.filter((order) => order.status === "proposed" || order.status === "live_submitted").length ?? 0;
  const dailyLoss = Math.min(0, portfolio?.dailyPnl ?? 0);
  const weeklyLoss = Math.min(0, portfolio?.weeklyPnl ?? 0);
  const spreadCents = Math.max(0, input.market.yesAsk - input.market.yesBid);
  const spreadBps = spreadCents * 100;
  const kellySize = cappedFractionalKelly({
    probability: input.forecast.fairProbability,
    price: input.forecast.marketProbability,
    bankroll: portfolio?.availableCapital ?? 10000,
    fraction: limits.kellyFraction,
    cap: limits.maxPositionSize
  });
  const positionSize = Math.min(input.requestedNotional, limits.maxPositionSize, Math.max(0, kellySize));

  if (input.requestedNotional > limits.maxPositionSize) {
    blockedBy.push("MAX_POSITION_SIZE");
    reasons.push(`Requested notional ${input.requestedNotional.toFixed(2)} exceeds max position size ${limits.maxPositionSize}.`);
  }
  if (sectorExposure + input.requestedNotional > limits.maxSectorExposure) {
    blockedBy.push("MAX_SECTOR_EXPOSURE");
    reasons.push(`Sector exposure would exceed ${limits.maxSectorExposure}.`);
  }
  if (openOrders >= limits.maxOpenOrders) {
    blockedBy.push("MAX_OPEN_ORDERS");
    reasons.push("Open order count is already at the configured limit.");
  }
  if (Math.abs(dailyLoss) >= limits.maxDailyLoss) {
    blockedBy.push("MAX_DAILY_LOSS");
    reasons.push("Daily loss limit has been reached.");
  }
  if (Math.abs(weeklyLoss) >= limits.maxWeeklyLoss) {
    blockedBy.push("MAX_WEEKLY_LOSS");
    reasons.push("Weekly loss limit has been reached.");
  }
  if (input.market.liquidity < limits.minLiquidity) {
    blockedBy.push("MIN_LIQUIDITY");
    reasons.push(`Liquidity ${input.market.liquidity} is below minimum ${limits.minLiquidity}.`);
  }
  if (spreadBps > limits.maxSlippageBps) {
    blockedBy.push("MAX_SLIPPAGE");
    reasons.push(`Bid/ask spread ${spreadBps} bps exceeds max slippage ${limits.maxSlippageBps} bps.`);
  }
  if (input.forecast.confidence < limits.minConfidence) {
    blockedBy.push("MIN_CONFIDENCE");
    reasons.push(`Confidence ${input.forecast.confidence.toFixed(2)} is below minimum ${limits.minConfidence}.`);
  }
  if (input.forecast.expectedValue <= 0) {
    blockedBy.push("NEGATIVE_EV");
    reasons.push("Expected value is not positive after market-implied probability comparison.");
  }

  const riskScore = Math.min(
    100,
    Math.round(
      input.forecast.downside * 35 +
        (1 - input.forecast.confidence) * 25 +
        (1 - input.forecast.liquidityQuality) * 20 +
        (input.requestedNotional / Math.max(1, limits.maxPositionSize)) * 20
    )
  );

  return {
    approved: blockedBy.length === 0,
    riskScore,
    positionSize: Number(positionSize.toFixed(2)),
    maxNotional: limits.maxPositionSize,
    reasons: reasons.length ? reasons : ["Within configured pre-trade risk limits."],
    blockedBy
  };
}

export function liveGateDecision(input: {
  requestedMode: string;
  enableLiveTrading: boolean;
  globalKillSwitch: boolean;
  missingPrerequisites: string[];
}): { approved: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.requestedMode !== "live") reasons.push("TRADING_MODE is not live.");
  if (!input.enableLiveTrading) reasons.push("ENABLE_LIVE_TRADING is not true.");
  if (input.globalKillSwitch) reasons.push("GLOBAL_KILL_SWITCH is active.");
  reasons.push(...input.missingPrerequisites.map((item) => `Missing ${item}.`));
  return {
    approved: reasons.length === 0,
    reasons: reasons.length ? reasons : ["Live gate prerequisites satisfied."]
  };
}
