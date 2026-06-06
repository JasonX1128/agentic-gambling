import { describe, expect, it } from "vitest";
import { demoMarkets } from "@/lib/data/seeds";
import { computeForecast } from "@/lib/quant/scoring";
import { evaluateRisk, liveGateDecision } from "@/lib/risk/engine";
import type { RiskLimits } from "@/lib/domain";

const limits: RiskLimits = {
  maxDailyLoss: 500,
  maxWeeklyLoss: 1500,
  maxPositionSize: 100,
  maxSectorExposure: 250,
  maxCorrelatedExposure: 350,
  maxOpenOrders: 5,
  maxSlippageBps: 150,
  minLiquidity: 25,
  minConfidence: 0.55,
  minEvidenceQuality: 0.55,
  maxRuleAmbiguity: 0.35,
  maxDrawdown: 1000,
  kellyFraction: 0.2
};

describe("risk engine", () => {
  it("blocks oversized trades before execution", () => {
    const market = demoMarkets[0];
    const decision = evaluateRisk(
      {
        market,
        forecast: computeForecast(market, 0.7),
        requestedNotional: 1000
      },
      limits
    );
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toContain("MAX_POSITION_SIZE");
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
