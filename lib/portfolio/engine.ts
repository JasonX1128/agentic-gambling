import type { PortfolioSnapshot, TradeOrder } from "@/lib/domain";
import { loadPortfolio, savePortfolio } from "@/lib/redis/coordination";

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
  const cost = (order.limitPrice / 100) * order.quantity;
  const existing = portfolio.positions.find((position) => position.ticker === order.ticker && position.mode === "paper");
  if (existing) {
    const currentContracts = order.side === "yes" ? existing.yesContracts : existing.noContracts;
    const nextContracts = currentContracts + order.quantity;
    const currentCost = existing.avgCost * currentContracts;
    existing.avgCost = nextContracts > 0 ? (currentCost + cost) / nextContracts : existing.avgCost;
    existing.markPrice = markPrice / 100;
    if (order.side === "yes") existing.yesContracts = nextContracts;
    else existing.noContracts = nextContracts;
    existing.unrealizedPnl = Math.round((existing.markPrice - existing.avgCost) * nextContracts * 100);
  } else {
    portfolio.positions.push({
      ticker: order.ticker,
      sector: order.sector,
      yesContracts: order.side === "yes" ? order.quantity : 0,
      noContracts: order.side === "no" ? order.quantity : 0,
      avgCost: order.limitPrice / 100,
      markPrice: markPrice / 100,
      realizedPnl: 0,
      unrealizedPnl: Math.round(((markPrice - order.limitPrice) / 100) * order.quantity * 100),
      mode: "paper"
    });
  }
  const filled = {
    ...order,
    status: "paper_filled" as const,
    filledAt: new Date().toISOString()
  };
  portfolio.orders = [filled, ...portfolio.orders].slice(0, 100);
  portfolio.cash = Number((portfolio.cash - cost).toFixed(2));
  portfolio.availableCapital = Number((portfolio.availableCapital - cost).toFixed(2));
  portfolio.openExposure = Number((portfolio.openExposure + cost).toFixed(2));
  portfolio.sectorExposure[order.sector] = Number(((portfolio.sectorExposure[order.sector] ?? 0) + cost).toFixed(2));
  portfolio.unrealizedPnl = portfolio.positions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
  portfolio.dailyPnl = portfolio.realizedPnl + portfolio.unrealizedPnl;
  portfolio.weeklyPnl = portfolio.realizedPnl + portfolio.unrealizedPnl;
  portfolio.netLiquidationValue = Number((portfolio.cash + portfolio.openExposure + portfolio.unrealizedPnl).toFixed(2));
  portfolio.updatedAt = new Date().toISOString();
  await savePortfolio(portfolio);
  return portfolio;
}

function emptyPortfolio(): PortfolioSnapshot {
  return {
    mode: "paper",
    cash: 10000,
    availableCapital: 10000,
    netLiquidationValue: 10000,
    dailyPnl: 0,
    weeklyPnl: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    openExposure: 0,
    sectorExposure: {},
    positions: [],
    orders: [],
    updatedAt: new Date().toISOString()
  };
}

function normalizePaperPortfolio(snapshot: PortfolioSnapshot): { snapshot: PortfolioSnapshot; changed: boolean } {
  const positions = snapshot.positions.filter((position) => !position.ticker.startsWith("KXDEMO-"));
  const orders = snapshot.orders.filter((order) => !order.ticker.startsWith("KXDEMO-"));
  const changed = positions.length !== snapshot.positions.length || orders.length !== snapshot.orders.length;
  if (!changed) return { snapshot, changed: false };

  const sectorExposure: Record<string, number> = {};
  for (const order of orders) {
    if (order.status !== "paper_filled" && order.status !== "live_submitted") continue;
    sectorExposure[order.sector] = Number(((sectorExposure[order.sector] ?? 0) + orderCost(order)).toFixed(2));
  }
  const openExposure = Number(Object.values(sectorExposure).reduce((sum, value) => sum + value, 0).toFixed(2));
  const unrealizedPnl = positions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const realizedPnl = positions.reduce((sum, position) => sum + position.realizedPnl, 0);
  const cash = Number((10000 - openExposure).toFixed(2));
  return {
    snapshot: {
      ...snapshot,
      cash,
      availableCapital: cash,
      netLiquidationValue: Number((cash + openExposure + unrealizedPnl).toFixed(2)),
      dailyPnl: realizedPnl + unrealizedPnl,
      weeklyPnl: realizedPnl + unrealizedPnl,
      realizedPnl,
      unrealizedPnl,
      openExposure,
      sectorExposure,
      positions,
      orders,
      updatedAt: new Date().toISOString()
    },
    changed: true
  };
}

function orderCost(order: TradeOrder): number {
  return (order.limitPrice / 100) * order.quantity;
}
