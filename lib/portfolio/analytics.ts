import type {
  PortfolioAnalyticsSummary,
  PortfolioPerformanceSnapshot,
  PortfolioSnapshot,
  PortfolioSnapshotReason
} from "@/lib/domain";

export type PortfolioSnapshotMeta = {
  reason: PortfolioSnapshotReason;
  portfolioId?: string;
  previous?: PortfolioPerformanceSnapshot;
  traceId?: string;
  cycleId?: string;
  orderId?: string;
  ticker?: string;
};

export function buildPortfolioPerformanceSnapshot(
  snapshot: PortfolioSnapshot,
  meta: PortfolioSnapshotMeta
): PortfolioPerformanceSnapshot {
  const previousNet = meta.previous?.netLiquidationValue;
  const returnFraction = previousNet && previousNet > 0
    ? roundFraction((snapshot.netLiquidationValue - previousNet) / previousNet)
    : undefined;
  return {
    id: `portfolio-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    portfolioId: meta.portfolioId ?? "main",
    reason: meta.reason,
    mode: snapshot.mode,
    netLiquidationValue: money(snapshot.netLiquidationValue),
    previousNetLiquidationValue: previousNet === undefined ? undefined : money(previousNet),
    returnFraction,
    pnlDelta: meta.previous ? money(snapshot.totalPnl - meta.previous.totalPnl) : undefined,
    openExposure: money(snapshot.openExposure),
    exposureDelta: meta.previous ? money(snapshot.openExposure - meta.previous.openExposure) : undefined,
    totalPnl: money(snapshot.totalPnl),
    realizedPnl: money(snapshot.realizedPnl),
    unrealizedPnl: money(snapshot.unrealizedPnl),
    closedPnl: money(snapshot.closedPnl),
    settledPnl: money(snapshot.settledPnl),
    cash: money(snapshot.cash),
    availableCapital: money(snapshot.availableCapital),
    positionCount: snapshot.positions.length,
    orderCount: snapshot.orders.length,
    settlementCount: snapshot.settlements.length,
    sectorExposure: snapshot.sectorExposure,
    traceId: meta.traceId,
    cycleId: meta.cycleId,
    orderId: meta.orderId,
    ticker: meta.ticker,
    createdAt: new Date().toISOString()
  };
}

export function summarizePortfolioPerformance(
  snapshots: PortfolioPerformanceSnapshot[]
): PortfolioAnalyticsSummary {
  const chronological = [...snapshots].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const first = chronological[0];
  const last = chronological.at(-1);
  const returns = chronological
    .map((snapshot) => snapshot.returnFraction)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const mean = returns.length ? average(returns) : undefined;
  const volatility = returns.length > 1 && mean !== undefined
    ? Math.sqrt(average(returns.map((value) => (value - mean) ** 2)))
    : undefined;
  const sampleSharpe = mean !== undefined && volatility && volatility > 0
    ? roundFraction((mean / volatility) * Math.sqrt(returns.length))
    : undefined;
  const drawdown = maxDrawdown(chronological);
  return {
    snapshotCount: snapshots.length,
    firstAt: first?.createdAt,
    lastAt: last?.createdAt,
    currentNetLiquidationValue: last?.netLiquidationValue,
    totalReturnFraction: first && last && first.netLiquidationValue > 0
      ? roundFraction((last.netLiquidationValue - first.netLiquidationValue) / first.netLiquidationValue)
      : undefined,
    meanReturnFraction: mean === undefined ? undefined : roundFraction(mean),
    returnVolatilityFraction: volatility === undefined ? undefined : roundFraction(volatility),
    sampleSharpe,
    maxDrawdownFraction: drawdown.fraction,
    maxDrawdownDollars: drawdown.dollars,
    positiveReturnRate: returns.length
      ? roundFraction(returns.filter((value) => value > 0).length / returns.length)
      : undefined,
    updatedAt: new Date().toISOString()
  };
}

function maxDrawdown(snapshots: PortfolioPerformanceSnapshot[]) {
  let peak = 0;
  let maxDrawdownDollars = 0;
  let maxDrawdownFraction = 0;
  for (const snapshot of snapshots) {
    peak = Math.max(peak, snapshot.netLiquidationValue);
    if (peak <= 0) continue;
    const drawdownDollars = Math.max(0, peak - snapshot.netLiquidationValue);
    const drawdownFraction = drawdownDollars / peak;
    maxDrawdownDollars = Math.max(maxDrawdownDollars, drawdownDollars);
    maxDrawdownFraction = Math.max(maxDrawdownFraction, drawdownFraction);
  }
  return {
    dollars: money(maxDrawdownDollars),
    fraction: roundFraction(maxDrawdownFraction)
  };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function money(value: number) {
  return Number(value.toFixed(2));
}

function roundFraction(value: number) {
  return Number(value.toFixed(8));
}
