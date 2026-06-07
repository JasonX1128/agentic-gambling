import { describe, expect, it } from "vitest";
import type { PortfolioPerformanceSnapshot, PortfolioSnapshot } from "@/lib/domain";
import { buildPortfolioPerformanceSnapshot, summarizePortfolioPerformance } from "@/lib/portfolio/analytics";

const basePortfolio: PortfolioSnapshot = {
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
    updatedAt: "2026-06-07T00:00:00.000Z"
  },
  updatedAt: "2026-06-07T00:00:00.000Z"
};

describe("portfolio performance analytics", () => {
  it("builds return snapshots from previous net liquidation value", () => {
    const previous = snapshot({ netLiquidationValue: 10000, totalPnl: 0, openExposure: 10 });
    const current = buildPortfolioPerformanceSnapshot(
      { ...basePortfolio, netLiquidationValue: 10050, totalPnl: 50, openExposure: 20 },
      { reason: "mark", previous, cycleId: "tick-1" }
    );

    expect(current.reason).toBe("mark");
    expect(current.returnFraction).toBeCloseTo(0.005);
    expect(current.pnlDelta).toBe(50);
    expect(current.exposureDelta).toBe(10);
    expect(current.cycleId).toBe("tick-1");
  });

  it("summarizes return stream with drawdown and sample Sharpe inputs", () => {
    const rows = [
      snapshot({ netLiquidationValue: 10000, createdAt: "2026-06-07T00:00:00.000Z" }),
      snapshot({ netLiquidationValue: 10100, previousNetLiquidationValue: 10000, returnFraction: 0.01, createdAt: "2026-06-07T00:01:00.000Z" }),
      snapshot({ netLiquidationValue: 10050, previousNetLiquidationValue: 10100, returnFraction: -0.0049505, createdAt: "2026-06-07T00:02:00.000Z" }),
      snapshot({ netLiquidationValue: 10200, previousNetLiquidationValue: 10050, returnFraction: 0.01492537, createdAt: "2026-06-07T00:03:00.000Z" })
    ];

    const summary = summarizePortfolioPerformance(rows);
    expect(summary.snapshotCount).toBe(4);
    expect(summary.totalReturnFraction).toBeCloseTo(0.02);
    expect(summary.maxDrawdownDollars).toBe(50);
    expect(summary.maxDrawdownFraction).toBeCloseTo(0.0049505);
    expect(summary.positiveReturnRate).toBeCloseTo(2 / 3);
    expect(summary.sampleSharpe).toBeGreaterThan(0);
  });
});

function snapshot(overrides: Partial<PortfolioPerformanceSnapshot>): PortfolioPerformanceSnapshot {
  return {
    id: "snapshot-test",
    portfolioId: "main",
    reason: "mark",
    mode: "paper",
    netLiquidationValue: 10000,
    openExposure: 0,
    totalPnl: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    closedPnl: 0,
    settledPnl: 0,
    cash: 10000,
    availableCapital: 10000,
    positionCount: 0,
    orderCount: 0,
    settlementCount: 0,
    sectorExposure: {},
    createdAt: "2026-06-07T00:00:00.000Z",
    ...overrides
  };
}
