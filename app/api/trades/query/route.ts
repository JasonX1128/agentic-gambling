import { NextRequest, NextResponse } from "next/server";
import { getPortfolioSnapshot } from "@/lib/portfolio/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const filters = (await req.json().catch(() => ({}))) as { status?: string; ticker?: string; sector?: string };
  const portfolio = await getPortfolioSnapshot();
  const orders = portfolio.orders.filter((order) => {
    if (filters.status && order.status !== filters.status) return false;
    if (filters.ticker && !order.ticker.includes(filters.ticker)) return false;
    return true;
  });
  const positions = portfolio.positions.filter((position) => {
    if (filters.ticker && !position.ticker.includes(filters.ticker)) return false;
    if (filters.sector && position.sector !== filters.sector) return false;
    return true;
  });
  const sectorPnl = positions.reduce<Record<string, { realizedPnl: number; unrealizedPnl: number; totalPnl: number; openExposure: number }>>(
    (acc, position) => {
      const row = acc[position.sector] ?? { realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0, openExposure: 0 };
      const quantity = position.yesContracts + position.noContracts;
      row.realizedPnl = Number((row.realizedPnl + position.realizedPnl).toFixed(2));
      row.unrealizedPnl = Number((row.unrealizedPnl + position.unrealizedPnl).toFixed(2));
      row.totalPnl = Number((row.realizedPnl + row.unrealizedPnl).toFixed(2));
      row.openExposure = Number((row.openExposure + position.avgCost * quantity).toFixed(2));
      acc[position.sector] = row;
      return acc;
    },
    {}
  );
  return NextResponse.json({ orders, positions, settlements: portfolio.settlements, calibration: portfolio.calibration, sectorPnl, portfolio });
}
