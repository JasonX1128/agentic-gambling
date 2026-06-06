import { describe, expect, it } from "vitest";
import { demoMarkets } from "@/lib/data/seeds";
import { computeForecast } from "@/lib/quant/scoring";
import { evaluateRisk, liveGateDecision } from "@/lib/risk/engine";
import type { RiskLimits } from "@/lib/domain";

const limits: RiskLimits = {
  maxDailyLoss: 1000,
  maxWeeklyLoss: 3000,
  maxPositionSize: 250,
  maxSectorExposure: 1000,
  maxCorrelatedExposure: 1500,
  maxOpenOrders: 20,
  maxSlippageBps: 2500,
  minLiquidity: 1,
  minConfidence: 0.35,
  minEvidenceQuality: 0.4,
  maxRuleAmbiguity: 0.6,
  maxDrawdown: 2000,
  kellyFraction: 0.25,
  riskAgentMaxPositionSize: 50,
  riskAgentTargetSectorExposure: 250,
  riskAgentTargetLiquidity: 100,
  riskAgentTargetConfidence: 0.62,
  riskAgentTargetSlippageBps: 150,
  riskAgentMaxRiskScore: 65
};

describe("risk engine", () => {
  it("negotiates oversized trades down to the Risk Agent target size", () => {
    const market = demoMarkets[0];
    const decision = evaluateRisk(
      {
        market,
        forecast: computeForecast(market, 0.7),
        requestedNotional: 1000
      },
      limits
    );
    expect(decision.approved).toBe(true);
    expect(decision.blockedBy).not.toContain("MAX_POSITION_SIZE");
    expect(decision.negotiableBlockedBy).toContain("MAX_POSITION_SIZE");
    expect(decision.negotiableBlockedBy).toContain("RISK_AGENT_SIZE");
    expect(decision.positionSize).toBeGreaterThan(0);
    expect(decision.positionSize).toBeLessThanOrEqual(limits.riskAgentMaxPositionSize);
  });

  it("approves a negotiated probe when spread misses the target but stays inside hard rails", () => {
    const market = demoMarkets[0];
    const decision = evaluateRisk(
      {
        market,
        forecast: computeForecast(market, 0.7),
        requestedNotional: 20
      },
      limits
    );
    expect(decision.approved).toBe(true);
    expect(decision.blockedBy).not.toContain("MAX_SLIPPAGE");
    expect(decision.negotiableBlockedBy).toContain("RISK_AGENT_SPREAD");
    expect(decision.counterOffer.accepted).toBe(true);
    expect(decision.counterOffer.conditions.join(" ")).toContain("spread");
  });

  it("hard-blocks extreme spreads that breach circuit-breaker rails", () => {
    const market = {
      ...demoMarkets[0],
      yesBid: 0,
      yesAsk: 100,
      noBid: 0,
      noAsk: 100
    };
    const decision = evaluateRisk(
      {
        market,
        forecast: computeForecast(market, 0.7),
        requestedNotional: 20
      },
      limits
    );
    expect(decision.approved).toBe(false);
    expect(decision.hardBlockedBy).toContain("MAX_SLIPPAGE");
  });

  it("treats loss-limit breaches as non-negotiable hard stops", () => {
    const market = demoMarkets[0];
    const decision = evaluateRisk(
      {
        market,
        forecast: computeForecast(market, 0.7),
        requestedNotional: 20,
        portfolio: {
          mode: "paper",
          cash: 1000,
          availableCapital: 1000,
          netLiquidationValue: 1000,
          dailyPnl: -1000,
          weeklyPnl: -1000,
          realizedPnl: 0,
          unrealizedPnl: 0,
          totalPnl: 0,
          closedPnl: 0,
          settledPnl: 0,
          openExposure: 0,
          sectorExposure: {},
          positions: [],
          orders: [],
          settlements: [],
          calibration: {
            settledTrades: 0,
            brierScore: 0,
            winRate: 0,
            byBucket: [],
            updatedAt: "2026-06-06T18:45:00.000Z"
          },
          updatedAt: "2026-06-06T18:45:00.000Z"
        }
      },
      limits
    );
    expect(decision.approved).toBe(false);
    expect(decision.hardBlockedBy).toContain("MAX_DAILY_LOSS");
    expect(decision.counterOffer.accepted).toBe(false);
  });

  it("blocks reversing an existing market side until the existing position is closed", () => {
    const market = demoMarkets[0];
    const decision = evaluateRisk(
      {
        market,
        forecast: computeForecast(market, 0.2),
        requestedNotional: 20,
        portfolio: {
          mode: "paper",
          cash: 1000,
          availableCapital: 1000,
          netLiquidationValue: 1000,
          dailyPnl: 0,
          weeklyPnl: 0,
          realizedPnl: 0,
          unrealizedPnl: 0,
          totalPnl: 0,
          closedPnl: 0,
          settledPnl: 0,
          openExposure: 0,
          sectorExposure: {},
          positions: [
            {
              ticker: market.ticker,
              sector: market.sector,
              yesContracts: 2,
              noContracts: 0,
              avgCost: 0.5,
              markPrice: 0.5,
              realizedPnl: 0,
              unrealizedPnl: 0,
              mode: "paper"
            }
          ],
          orders: [],
          settlements: [],
          calibration: {
            settledTrades: 0,
            brierScore: 0,
            winRate: 0,
            byBucket: [],
            updatedAt: "2026-06-06T18:45:00.000Z"
          },
          updatedAt: "2026-06-06T18:45:00.000Z"
        }
      },
      limits
    );
    expect(decision.approved).toBe(false);
    expect(decision.hardBlockedBy).toContain("OPPOSITE_POSITION");
  });

  it("denies live mode when any prerequisite is missing", () => {
    const decision = liveGateDecision({
      requestedMode: "paper",
      enableLiveTrading: false,
      globalKillSwitch: false,
      missingPrerequisites: ["KALSHI_API_KEY"]
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(" ")).toContain("KALSHI_API_KEY");
  });
});
