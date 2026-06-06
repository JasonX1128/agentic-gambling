import { describe, expect, it, vi } from "vitest";
import { buildTradeOrder, orderNotional, quantityForBudget } from "@/lib/execution/engine";
import { demoMarkets } from "@/lib/data/seeds";
import { computeForecast } from "@/lib/quant/scoring";
import { evaluateRisk } from "@/lib/risk/engine";
import { getRiskLimits } from "@/lib/config/env";
import type { Opportunity } from "@/lib/domain";

vi.mock("server-only", () => ({}));

describe("execution sizing", () => {
  it("converts dollar risk budget into Kalshi cent-priced contract count", () => {
    expect(quantityForBudget(42.5, 6)).toBe(708);
    expect(quantityForBudget(50, 100)).toBe(50);
  });

  it("builds paper orders with sector metadata and dollar notional", () => {
    const market = {
      ...demoMarkets[0],
      yesBid: 5,
      yesAsk: 6,
      noBid: 93,
      noAsk: 95,
      lastPrice: 6
    };
    const forecast = computeForecast(market, 0.02);
    const risk = evaluateRisk({ market, forecast, requestedNotional: 42.5 }, getRiskLimits());
    const opportunity: Opportunity = {
      id: `opp-${market.ticker}`,
      market,
      side: "no",
      rankScore: 1,
      forecast,
      thesis: {
        summary: "Test thesis.",
        bullCase: [],
        bearCase: [],
        invalidation: [],
        evidence: []
      },
      debate: [],
      risk,
      compliance: {
        approved: true,
        policyVersion: "test",
        humanApprovalRequired: false,
        blockedReasons: [],
        warnings: []
      },
      sector: market.sector,
      podId: `pod-${market.sector}`,
      status: "approved_for_paper",
      createdAt: new Date().toISOString()
    };
    const order = buildTradeOrder(opportunity, "paper", "agent", "audit-test");
    expect(order.sector).toBe(market.sector);
    expect(order.limitPrice).toBe(market.noAsk);
    expect(orderNotional(order)).toBeLessThanOrEqual(risk.positionSize);
  });
});
