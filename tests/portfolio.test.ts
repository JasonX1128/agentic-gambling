import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioPerformanceSnapshot, PortfolioSnapshot, TradeOrder } from "@/lib/domain";
import { applyPaperClose, applyPaperFill, applyPaperSettlement, getPortfolioSnapshot, markPortfolioToMarket } from "@/lib/portfolio/engine";
import { demoMarkets } from "@/lib/data/seeds";

const store = vi.hoisted(() => ({
  snapshot: undefined as PortfolioSnapshot | undefined,
  performanceSnapshots: [] as PortfolioPerformanceSnapshot[]
}));

vi.mock("@/lib/redis/coordination", () => ({
  loadPortfolio: vi.fn(() => Promise.resolve(store.snapshot)),
  savePortfolio: vi.fn((snapshot: PortfolioSnapshot) => {
    store.snapshot = snapshot;
    return Promise.resolve();
  }),
  loadLatestPortfolioPerformanceSnapshot: vi.fn(() => Promise.resolve(store.performanceSnapshots[0])),
  savePortfolioPerformanceSnapshot: vi.fn((snapshot: PortfolioPerformanceSnapshot) => {
    store.performanceSnapshots = [snapshot, ...store.performanceSnapshots];
    return Promise.resolve();
  })
}));

function order(overrides: Partial<TradeOrder> = {}): TradeOrder {
  return {
    id: "paper-test",
    opportunityId: "opp-test",
    ticker: "KXTEST",
    sector: "test",
    mode: "paper",
    action: "buy",
    side: "yes",
    quantity: 10,
    limitPrice: 40,
    status: "proposed",
    source: "agent",
    auditId: "audit-test",
    createdAt: "2026-06-06T20:00:00.000Z",
    forecastProbability: 0.7,
    marketProbability: 0.4,
    expectedValue: 0.3,
    confidence: 0.7,
    calibrationBucket: "0.7-0.8",
    ...overrides
  };
}

describe("portfolio accounting", () => {
  beforeEach(() => {
    store.snapshot = undefined;
    store.performanceSnapshots = [];
  });

  it("separates unrealized PnL from realized and total PnL after a mark refresh", async () => {
    await applyPaperFill(order(), 40);
    const portfolio = await markPortfolioToMarket([
      {
        ...demoMarkets[0],
        id: "KXTEST",
        ticker: "KXTEST",
        yesBid: 49,
        yesAsk: 51,
        lastPrice: 50,
        source: "kalshi"
      }
    ]);
    expect(portfolio.openExposure).toBe(4);
    expect(portfolio.unrealizedPnl).toBe(1);
    expect(portfolio.realizedPnl).toBe(0);
    expect(portfolio.totalPnl).toBe(1);
    expect(portfolio.netLiquidationValue).toBe(10001);
    expect(store.performanceSnapshots.map((snapshot) => snapshot.reason)).toEqual(["mark", "fill"]);
    expect(store.performanceSnapshots[0].returnFraction).toBeCloseTo(0.0001);
  });

  it("moves closed paper trades into realized closed PnL", async () => {
    await applyPaperFill(order(), 40);
    const result = await applyPaperClose({ ticker: "KXTEST", exitPrice: 55, source: "operator" });
    expect(result.realizedPnl).toBe(1.5);
    expect(result.portfolio.positions).toHaveLength(0);
    expect(result.portfolio.closedPnl).toBe(1.5);
    expect(result.portfolio.settledPnl).toBe(0);
    expect(result.portfolio.realizedPnl).toBe(1.5);
    expect(result.portfolio.totalPnl).toBe(1.5);
  });

  it("moves settled paper outcomes into settled PnL and calibration", async () => {
    await applyPaperFill(order(), 40);
    const result = await applyPaperSettlement({ ticker: "KXTEST", outcome: "yes", source: "operator", notes: "test settlement" });
    expect(result.settlement.realizedPnl).toBe(6);
    expect(result.settlement.brierScore).toBeCloseTo(0.09);
    expect(result.portfolio.settledPnl).toBe(6);
    expect(result.portfolio.realizedPnl).toBe(6);
    expect(result.portfolio.calibration.settledTrades).toBe(1);
    expect(result.portfolio.calibration.winRate).toBe(1);
  });

  it("migrates old snapshots without settlement fields", async () => {
    store.snapshot = ({
      mode: "paper",
      cash: 9996,
      availableCapital: 9996,
      netLiquidationValue: 10000,
      dailyPnl: 0,
      weeklyPnl: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      openExposure: 4,
      sectorExposure: { test: 4 },
      positions: [
        {
          ticker: "KXTEST",
          sector: "test",
          yesContracts: 10,
          noContracts: 0,
          avgCost: 0.4,
          markPrice: 0.4,
          realizedPnl: 0,
          unrealizedPnl: 0,
          mode: "paper"
        }
      ],
      orders: [],
      updatedAt: "2026-06-06T20:00:00.000Z"
    } as unknown) as PortfolioSnapshot;
    const portfolio = await getPortfolioSnapshot();
    expect(portfolio.totalPnl).toBe(0);
    expect(portfolio.settlements).toEqual([]);
    expect(portfolio.calibration.settledTrades).toBe(0);
  });
});
