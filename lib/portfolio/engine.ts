import type {
  CalibrationSummary,
  Market,
  OrderSide,
  PortfolioSnapshot,
  Position,
  SettlementOutcome,
  SettlementRecord,
  TradeOrder,
  TradeSource
} from "@/lib/domain";
import type { PortfolioSnapshotMeta } from "@/lib/portfolio/analytics";
import { buildPortfolioPerformanceSnapshot } from "@/lib/portfolio/analytics";
import { brierScore } from "@/lib/quant/scoring";
import {
  loadLatestPortfolioPerformanceSnapshot,
  loadPortfolio,
  savePortfolio,
  savePortfolioPerformanceSnapshot
} from "@/lib/redis/coordination";

const STARTING_CAPITAL = 10000;

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  try {
    const loaded = await loadPortfolio();
    if (!loaded) return emptyPortfolio();
    const normalized = normalizePaperPortfolio(loaded);
    if (normalized.changed) await savePortfolio(normalized.snapshot);
    return normalized.snapshot;
  } catch {
    return emptyPortfolio();
  }
}

export async function applyPaperFill(order: TradeOrder, markPrice: number): Promise<PortfolioSnapshot> {
  const portfolio = await getPortfolioSnapshot();
  const cost = orderCost(order);
  const mark = markPrice / 100;
  const existing = portfolio.positions.find((position) => position.ticker === order.ticker && position.mode === "paper");
  if (existing) {
    const side = positionSide(existing);
    if (side && side !== order.side) {
      throw new Error(`Cannot add ${order.side.toUpperCase()} exposure while ${side.toUpperCase()} paper position is open.`);
    }
    const currentContracts = positionQuantity(existing);
    const nextContracts = currentContracts + order.quantity;
    const currentCost = existing.avgCost * currentContracts;
    existing.avgCost = nextContracts > 0 ? (currentCost + cost) / nextContracts : existing.avgCost;
    existing.markPrice = mark;
    if (order.side === "yes") existing.yesContracts = nextContracts;
    else existing.noContracts = nextContracts;
  } else {
    portfolio.positions.push({
      ticker: order.ticker,
      sector: order.sector,
      yesContracts: order.side === "yes" ? order.quantity : 0,
      noContracts: order.side === "no" ? order.quantity : 0,
      avgCost: order.limitPrice / 100,
      markPrice: mark,
      realizedPnl: 0,
      unrealizedPnl: 0,
      mode: "paper"
    });
  }
  const filled = {
    ...order,
    status: "paper_filled" as const,
    filledAt: new Date().toISOString()
  };
  portfolio.orders = [filled, ...portfolio.orders].slice(0, 150);
  return saveRecalculated(portfolio, { reason: "fill", orderId: filled.id, ticker: order.ticker, traceId: order.traceId });
}

export async function applyPaperClose(input: {
  ticker: string;
  exitPrice: number;
  quantity?: number;
  source: TradeSource;
  auditId?: string;
  reason?: string;
}): Promise<{ order: TradeOrder; portfolio: PortfolioSnapshot; realizedPnl: number }> {
  const portfolio = await getPortfolioSnapshot();
  const position = requirePosition(portfolio, input.ticker);
  const side = requirePositionSide(position);
  const openQuantity = positionQuantity(position);
  const quantity = Math.min(openQuantity, Math.max(1, Math.floor(input.quantity ?? openQuantity)));
  const realizedPnl = money((input.exitPrice / 100 - position.avgCost) * quantity);
  reducePosition(position, side, quantity);
  portfolio.closedPnl = money((portfolio.closedPnl ?? 0) + realizedPnl);
  const order: TradeOrder = {
    id: `paper-close-${position.ticker}-${Date.now()}`,
    opportunityId: `close-${position.ticker}`,
    ticker: position.ticker,
    sector: position.sector,
    mode: "paper",
    action: "sell",
    side,
    quantity,
    limitPrice: input.exitPrice,
    status: "paper_closed",
    source: input.source,
    auditId: input.auditId ?? `audit-${Date.now()}`,
    createdAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
    realizedPnl
  };
  if (!positionQuantity(position)) {
    portfolio.positions = portfolio.positions.filter((item) => item.ticker !== position.ticker);
  }
  portfolio.orders = [order, ...portfolio.orders].slice(0, 150);
  return { order, portfolio: await saveRecalculated(portfolio, { reason: "close", orderId: order.id, ticker: order.ticker }), realizedPnl };
}

export async function applyPaperSettlement(input: {
  ticker: string;
  outcome: SettlementOutcome;
  source: TradeSource;
  notes?: string;
  auditId?: string;
}): Promise<{ settlement: SettlementRecord; order: TradeOrder; portfolio: PortfolioSnapshot }> {
  const portfolio = await getPortfolioSnapshot();
  const position = requirePosition(portfolio, input.ticker);
  const side = requirePositionSide(position);
  const quantity = positionQuantity(position);
  const settlementPrice = side === input.outcome ? 100 : 0;
  const realizedPnl = money((settlementPrice / 100 - position.avgCost) * quantity);
  const sourceOrder = portfolio.orders
    .filter((order) => order.ticker === position.ticker && order.status === "paper_filled")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const actualWon = side === input.outcome;
  const settlement: SettlementRecord = {
    id: `settlement-${position.ticker}-${Date.now()}`,
    ticker: position.ticker,
    sector: position.sector,
    side,
    outcome: input.outcome,
    quantity,
    entryPrice: money(position.avgCost * 100),
    settlementPrice,
    realizedPnl,
    forecastProbability: sourceOrder?.forecastProbability,
    marketProbability: sourceOrder?.marketProbability,
    expectedValue: sourceOrder?.expectedValue,
    confidence: sourceOrder?.confidence,
    calibrationBucket: sourceOrder?.calibrationBucket,
    brierScore: sourceOrder?.forecastProbability === undefined ? undefined : brierScore(sourceOrder.forecastProbability, actualWon),
    notes: input.notes,
    settledAt: new Date().toISOString(),
    source: input.source
  };
  const order: TradeOrder = {
    id: `paper-settle-${position.ticker}-${Date.now()}`,
    opportunityId: `settle-${position.ticker}`,
    ticker: position.ticker,
    sector: position.sector,
    mode: "paper",
    action: "sell",
    side,
    quantity,
    limitPrice: settlementPrice,
    status: "paper_settled",
    source: input.source,
    auditId: input.auditId ?? `audit-${Date.now()}`,
    createdAt: new Date().toISOString(),
    settledAt: settlement.settledAt,
    realizedPnl,
    forecastProbability: sourceOrder?.forecastProbability,
    marketProbability: sourceOrder?.marketProbability,
    expectedValue: sourceOrder?.expectedValue,
    confidence: sourceOrder?.confidence,
    calibrationBucket: sourceOrder?.calibrationBucket
  };
  portfolio.positions = portfolio.positions.filter((item) => item.ticker !== position.ticker);
  portfolio.settledPnl = money((portfolio.settledPnl ?? 0) + realizedPnl);
  portfolio.settlements = [settlement, ...(portfolio.settlements ?? [])].slice(0, 150);
  portfolio.orders = [order, ...portfolio.orders].slice(0, 150);
  return { settlement, order, portfolio: await saveRecalculated(portfolio, { reason: "settlement", orderId: order.id, ticker: order.ticker }) };
}

export async function markPortfolioToMarket(markets: Market[]): Promise<PortfolioSnapshot> {
  const portfolio = await getPortfolioSnapshot();
  const marketsByTicker = new Map(markets.map((market) => [market.ticker, market]));
  let changed = false;
  for (const position of portfolio.positions) {
    const market = marketsByTicker.get(position.ticker);
    if (!market) continue;
    const side = positionSide(position);
    if (!side) continue;
    const nextMark = markPriceForPosition(market, side) / 100;
    if (Number.isFinite(nextMark) && Math.abs(position.markPrice - nextMark) > 0.0001) {
      position.markPrice = nextMark;
      changed = true;
    }
  }
  if (changed) return saveRecalculated(portfolio, { reason: "mark" });
  await recordPortfolioPerformanceSnapshot(portfolio, { reason: "mark" });
  return portfolio;
}

export async function recordPortfolioPerformanceSnapshot(snapshot: PortfolioSnapshot, meta: PortfolioSnapshotMeta) {
  const previous = await loadLatestPortfolioPerformanceSnapshot();
  const record = buildPortfolioPerformanceSnapshot(snapshot, { ...meta, previous });
  await savePortfolioPerformanceSnapshot(record);
  return record;
}

function emptyPortfolio(): PortfolioSnapshot {
  return {
    mode: "paper",
    cash: STARTING_CAPITAL,
    availableCapital: STARTING_CAPITAL,
    netLiquidationValue: STARTING_CAPITAL,
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
    calibration: emptyCalibration(),
    updatedAt: new Date().toISOString()
  };
}

function normalizePaperPortfolio(snapshot: PortfolioSnapshot): { snapshot: PortfolioSnapshot; changed: boolean } {
  const base = {
    ...emptyPortfolio(),
    ...snapshot,
    positions: snapshot.positions ?? [],
    orders: snapshot.orders ?? [],
    settlements: snapshot.settlements ?? []
  };
  const positions = base.positions.filter((position) => !position.ticker.startsWith("KXDEMO-"));
  const orders = base.orders.filter((order) => !order.ticker.startsWith("KXDEMO-"));
  const settlements = base.settlements.filter((settlement) => !settlement.ticker.startsWith("KXDEMO-"));
  const migratedClosedPnl = base.closedPnl ?? 0;
  const migratedSettledPnl = base.settledPnl ?? 0;
  const snapshotChanged =
    positions.length !== base.positions.length ||
    orders.length !== base.orders.length ||
    settlements.length !== base.settlements.length ||
    base.totalPnl === undefined ||
    base.closedPnl === undefined ||
    base.settledPnl === undefined ||
    base.calibration === undefined;
  return {
    snapshot: recalculatePortfolio({
      ...base,
      positions,
      orders,
      settlements,
      closedPnl: migratedClosedPnl,
      settledPnl: migratedSettledPnl
    }),
    changed: snapshotChanged
  };
}

async function saveRecalculated(portfolio: PortfolioSnapshot, snapshotMeta: PortfolioSnapshotMeta): Promise<PortfolioSnapshot> {
  const next = recalculatePortfolio(portfolio);
  await savePortfolio(next);
  await recordPortfolioPerformanceSnapshot(next, snapshotMeta);
  return next;
}

function recalculatePortfolio(portfolio: PortfolioSnapshot): PortfolioSnapshot {
  const positions = portfolio.positions
    .filter((position) => !position.ticker.startsWith("KXDEMO-"))
    .filter((position) => positionQuantity(position) > 0)
    .map((position) => {
      const quantity = positionQuantity(position);
      return {
        ...position,
        unrealizedPnl: money((position.markPrice - position.avgCost) * quantity)
      };
    });
  const sectorExposure: Record<string, number> = {};
  for (const position of positions) {
    sectorExposure[position.sector] = money((sectorExposure[position.sector] ?? 0) + position.avgCost * positionQuantity(position));
  }
  const openExposure = money(Object.values(sectorExposure).reduce((sum, value) => sum + value, 0));
  const closedPnl = money(portfolio.closedPnl ?? 0);
  const settledPnl = money(portfolio.settledPnl ?? 0);
  const realizedPnl = money(closedPnl + settledPnl);
  const unrealizedPnl = money(positions.reduce((sum, position) => sum + position.unrealizedPnl, 0));
  const totalPnl = money(realizedPnl + unrealizedPnl);
  const cash = money(STARTING_CAPITAL - openExposure + realizedPnl);
  return {
    ...portfolio,
    cash,
    availableCapital: cash,
    netLiquidationValue: money(cash + openExposure + unrealizedPnl),
    dailyPnl: totalPnl,
    weeklyPnl: totalPnl,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    closedPnl,
    settledPnl,
    openExposure,
    sectorExposure,
    positions,
    orders: (portfolio.orders ?? []).filter((order) => !order.ticker.startsWith("KXDEMO-")).slice(0, 150),
    settlements: (portfolio.settlements ?? []).filter((settlement) => !settlement.ticker.startsWith("KXDEMO-")).slice(0, 150),
    calibration: buildCalibration(portfolio.settlements ?? []),
    updatedAt: new Date().toISOString()
  };
}

function buildCalibration(settlements: SettlementRecord[]): CalibrationSummary {
  const scored = settlements.filter((settlement) => settlement.brierScore !== undefined);
  if (!scored.length) return emptyCalibration();
  const grouped = new Map<string, SettlementRecord[]>();
  for (const settlement of scored) {
    const bucket = settlement.calibrationBucket ?? "unknown";
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), settlement]);
  }
  const averageBrier = scored.reduce((sum, settlement) => sum + (settlement.brierScore ?? 0), 0) / scored.length;
  const wins = scored.filter((settlement) => settlement.side === settlement.outcome).length;
  return {
    settledTrades: scored.length,
    brierScore: Number(averageBrier.toFixed(4)),
    winRate: Number((wins / scored.length).toFixed(4)),
    byBucket: Array.from(grouped.entries())
      .map(([bucket, rows]) => ({
        bucket,
        count: rows.length,
        brierScore: Number((rows.reduce((sum, row) => sum + (row.brierScore ?? 0), 0) / rows.length).toFixed(4)),
        winRate: Number((rows.filter((row) => row.side === row.outcome).length / rows.length).toFixed(4))
      }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket)),
    updatedAt: new Date().toISOString()
  };
}

function emptyCalibration(): CalibrationSummary {
  return {
    settledTrades: 0,
    brierScore: 0,
    winRate: 0,
    byBucket: [],
    updatedAt: new Date().toISOString()
  };
}

function requirePosition(portfolio: PortfolioSnapshot, ticker: string): Position {
  const position = portfolio.positions.find((item) => item.ticker === ticker);
  if (!position) throw new Error(`No open paper position found for ${ticker}.`);
  return position;
}

function requirePositionSide(position: Position): OrderSide {
  const side = positionSide(position);
  if (!side) throw new Error(`Open paper position ${position.ticker} has no contracts.`);
  return side;
}

function positionSide(position: Position): OrderSide | undefined {
  if (position.yesContracts > 0 && position.noContracts <= 0) return "yes";
  if (position.noContracts > 0 && position.yesContracts <= 0) return "no";
  return undefined;
}

function positionQuantity(position: Position): number {
  return position.yesContracts + position.noContracts;
}

function reducePosition(position: Position, side: OrderSide, quantity: number) {
  if (side === "yes") position.yesContracts = Math.max(0, position.yesContracts - quantity);
  else position.noContracts = Math.max(0, position.noContracts - quantity);
}

function markPriceForPosition(market: Market, side: OrderSide): number {
  if (side === "yes") {
    if (market.lastPrice > 0) return market.lastPrice;
    return market.yesBid > 0 && market.yesAsk > 0 ? (market.yesBid + market.yesAsk) / 2 : market.yesAsk || market.yesBid;
  }
  if (market.lastPrice > 0) return Math.max(0, 100 - market.lastPrice);
  return market.noBid > 0 && market.noAsk > 0 ? (market.noBid + market.noAsk) / 2 : market.noAsk || market.noBid;
}

function orderCost(order: TradeOrder): number {
  return money((order.limitPrice / 100) * order.quantity);
}

function money(value: number): number {
  return Number(value.toFixed(2));
}
