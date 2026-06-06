import type { PortfolioSnapshot, TradeOrder } from "@/lib/domain";
import { demoPortfolio } from "@/lib/data/seeds";
import { loadPortfolio, savePortfolio } from "@/lib/redis/coordination";

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  try {
    return (await loadPortfolio()) ?? demoPortfolio;
  } catch {
    return {
      ...demoPortfolio,
      updatedAt: new Date().toISOString()
    };
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
      sector: "unclassified",
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
  portfolio.unrealizedPnl = portfolio.positions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
  portfolio.netLiquidationValue = Number((portfolio.cash + portfolio.openExposure + portfolio.unrealizedPnl).toFixed(2));
  portfolio.updatedAt = new Date().toISOString();
  await savePortfolio(portfolio);
  return portfolio;
}
