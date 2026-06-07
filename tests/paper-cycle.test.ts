import { describe, expect, it, vi } from "vitest";
import { selectPaperCycleSlate } from "@/lib/agents/paper-cycle";
import { classifyPodSector } from "@/lib/agents/fund-management";
import type { Market, Opportunity, PortfolioSnapshot } from "@/lib/domain";

vi.mock("server-only", () => ({}));

const now = "2026-06-06T20:00:00.000Z";

describe("paper cycle pod allocation", () => {
  it("reserves first probes for incubating pods instead of starving them by global rank", () => {
    const baseball = Array.from({ length: 4 }, (_, index) =>
      opportunity(
        market({
          id: `KXMLBTOTAL-${index}`,
          ticker: `KXMLBTOTAL-26JUN061415CINSTL-${index}`,
          title: `Cincinnati vs St. Louis Total Runs ${index}?`,
          sector: "sports"
        }),
        0.2
      )
    );
    const macro = opportunity(
      market({
        id: "KXFED-TEST",
        ticker: "KXFED-26JUN-FEDCUT",
        title: "Will the Fed cut rates?",
        sector: "macro"
      }),
      0.04
    );

    const slate = selectPaperCycleSlate([...baseball, macro], portfolio(), 2, 0);
    const selectedPods = new Set(slate.map((item) => classifyPodSector(item.opportunity.market)));

    expect(slate).toHaveLength(2);
    expect(selectedPods).toContain("sports: baseball totals");
    expect(selectedPods).toContain("macro: rates inflation");
  });
});

function market(overrides: Partial<Market>): Market {
  return {
    id: "KXMLBTOTAL-TEST",
    ticker: "KXMLBTOTAL-26JUN061415CINSTL-15",
    title: "Cincinnati vs St. Louis Total Runs?",
    category: "Sports",
    sector: "sports",
    status: "open",
    closeTime: "2026-06-09T18:15:00Z",
    yesBid: 10,
    yesAsk: 12,
    noBid: 88,
    noAsk: 90,
    lastPrice: 11,
    volume: 1000,
    openInterest: 100,
    liquidity: 500,
    ruleSummary: "Settles from public result.",
    settlementSource: "Public source",
    source: "kalshi",
    updatedAt: now,
    ...overrides
  };
}

function opportunity(row: Market, expectedValue: number): Opportunity {
  return {
    id: `opp-${row.ticker}`,
    market: row,
    side: "yes",
    rankScore: expectedValue * 100,
    forecast: {
      marketId: row.id,
      marketProbability: 0.1,
      fairProbability: 0.1 + expectedValue,
      expectedValue,
      confidence: 0.7,
      liquidityQuality: 0.8,
      uncertainty: 0.3,
      downside: 0.2,
      calibrationBucket: "0.1-0.2"
    },
    thesis: {
      summary: "Test edge.",
      bullCase: [],
      bearCase: [],
      invalidation: [],
      evidence: []
    },
    debate: [],
    risk: {
      approved: true,
      riskScore: 20,
      positionSize: 20,
      maxNotional: 50,
      reasons: ["test"],
      blockedBy: [],
      hardBlockedBy: [],
      negotiableBlockedBy: [],
      counterOffer: {
        accepted: true,
        positionSize: 20,
        maxEntryPrice: 12,
        maxSpreadBps: 150,
        conditions: [],
        analystRequiredActions: []
      },
      negotiation: []
    },
    compliance: {
      approved: true,
      policyVersion: "test",
      humanApprovalRequired: false,
      blockedReasons: [],
      warnings: []
    },
    sector: row.sector,
    podId: `pod-${row.sector}`,
    status: "approved_for_paper",
    createdAt: now
  };
}

function portfolio(): PortfolioSnapshot {
  return {
    mode: "paper",
    cash: 10000,
    availableCapital: 10000,
    netLiquidationValue: 10000,
    dailyPnl: 0,
    weeklyPnl: 0,
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
      updatedAt: now
    },
    updatedAt: now
  };
}
