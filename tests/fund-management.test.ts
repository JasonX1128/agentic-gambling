import { describe, expect, it } from "vitest";
import { buildFundOperatingState, classifyTickerPod } from "@/lib/agents/fund-management";
import type { Market, Opportunity, PortfolioSnapshot } from "@/lib/domain";

const now = "2026-06-06T20:00:00.000Z";

function market(overrides: Partial<Market> = {}): Market {
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
    ruleSummary: "Settles from public game result.",
    settlementSource: "Public box score",
    source: "kalshi",
    updatedAt: now,
    ...overrides
  };
}

function portfolio(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
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
    updatedAt: now,
    ...overrides
  };
}

function opportunity(row: Market): Opportunity {
  return {
    id: `opp-${row.ticker}`,
    market: row,
    side: "yes",
    rankScore: 80,
    forecast: {
      marketId: row.id,
      marketProbability: 0.1,
      fairProbability: 0.18,
      expectedValue: 0.08,
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
      positionSize: 10,
      maxNotional: 50,
      reasons: ["test"],
      blockedBy: [],
      hardBlockedBy: [],
      negotiableBlockedBy: [],
      counterOffer: {
        accepted: true,
        positionSize: 10,
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
    podId: "pod-sports-baseball-totals",
    status: "approved_for_paper",
    createdAt: now
  };
}

describe("fund operating state", () => {
  it("classifies Kalshi market clusters into dynamic pod sectors", () => {
    expect(classifyTickerPod("KXMLBTOTAL-26JUN061415CINSTL-15", "sports")).toBe("sports: baseball totals");
    expect(classifyTickerPod("KXMLBSPREAD-26JUN061605CWSPHI-CWS9", "sports")).toBe("sports: spreads");
  });

  it("creates incubating pod proposals when scouts find approved candidates", () => {
    const row = market();
    const state = buildFundOperatingState({
      markets: [row],
      opportunities: [opportunity(row), opportunity({ ...row, ticker: "KXMLBTOTAL-26JUN061415CINSTL-16", id: "two" })],
      portfolio: portfolio()
    });
    expect(state.pods[0].lifecycleStatus).toBe("incubating");
    expect(state.podProposals.length).toBeGreaterThan(0);
    expect(state.researchScouts.some((scout) => scout.status === "proposing")).toBe(true);
  });

  it("promotes strong pods to active with performance-adjusted capital budgets", () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      market({
        id: `market-${index}`,
        ticker: `KXMLBTOTAL-26JUN061415CINSTL-${index}`,
        title: `Cincinnati vs St. Louis Total Runs ${index}?`
      })
    );
    const state = buildFundOperatingState({
      markets: rows,
      opportunities: rows.map(opportunity),
      portfolio: portfolio()
    });

    expect(state.pods[0].lifecycleStatus).toBe("active");
    expect(state.pods[0].mandate.capitalBudget).toBeGreaterThan(300);
    expect(state.pods[0].mandate.availableBudget).toBe(state.pods[0].mandate.capitalBudget);
    expect(state.pods[0].mandate.budgetDecision).toMatch(/Active budget/i);
  });

  it("creates cross-pod analyst briefings for collaborative pod check-ins", () => {
    const baseball = market({
      ticker: "KXMLBTOTAL-26JUN061415CINSTL-15",
      title: "Cincinnati vs St. Louis Total Runs?"
    });
    const macro = market({
      id: "macro",
      ticker: "KXFED-26JUN-FEDCUT",
      title: "Will the Fed cut rates?",
      sector: "macro",
      category: "Economics"
    });
    const state = buildFundOperatingState({
      markets: [baseball, macro],
      opportunities: [opportunity(baseball), opportunity(macro)],
      portfolio: portfolio()
    });

    expect(state.crossPodBriefings.length).toBeGreaterThan(0);
    expect(state.crossPodBriefings[0].toSectors.length).toBeGreaterThan(0);
    expect(state.crossPodBriefings[0].watchItems.length).toBeGreaterThan(0);
    expect(state.crossPodBriefings[0].proposedActions.length).toBeGreaterThan(0);
  });

  it("puts losing pods on executive defense", () => {
    const row = market();
    const state = buildFundOperatingState({
      markets: [row],
      opportunities: [],
      portfolio: portfolio({
        positions: [
          {
            ticker: row.ticker,
            sector: row.sector,
            yesContracts: 100,
            noContracts: 0,
            avgCost: 0.8,
            markPrice: 0.4,
            realizedPnl: 0,
            unrealizedPnl: -40,
            mode: "paper"
          }
        ]
      })
    });
    expect(state.pods[0].lifecycleStatus).toBe("defense");
    expect(state.executiveReviews[0].status).toBe("defense");
    expect(state.pods[0].mandate.requiredDefense.length).toBeGreaterThan(0);
  });

  it("ignores immaterial negative PnL instead of putting pods on PIP", () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      market({
        id: `tiny-loss-market-${index}`,
        ticker: `KXMLBTOTAL-26JUN061415CINSTL-${index}`,
        title: `Cincinnati vs St. Louis Total Runs ${index}?`
      })
    );
    const state = buildFundOperatingState({
      markets: rows,
      opportunities: rows.map(opportunity),
      portfolio: portfolio({
        positions: [
          {
            ticker: rows[0].ticker,
            sector: rows[0].sector,
            yesContracts: 10,
            noContracts: 0,
            avgCost: 0.5,
            markPrice: 0.499,
            realizedPnl: 0,
            unrealizedPnl: -0.02,
            mode: "paper"
          }
        ]
      })
    });

    expect(state.pods[0].mandate.totalPnl).toBe(-0.02);
    expect(state.pods[0].lifecycleStatus).toBe("active");
    expect(state.executiveReviews).toHaveLength(0);
    expect(state.budgetCommitteeRecords[0].decision).not.toBe("shrink");
  });

  it("sleeps the research loop when there are no markets or proposals", () => {
    const state = buildFundOperatingState({ markets: [], opportunities: [], portfolio: portfolio() });
    expect(state.pods).toHaveLength(0);
    expect(state.researchScouts[0].status).toBe("sleeping");
    expect(state.researchScouts[0].sleepUntil).toBeTruthy();
  });
});
