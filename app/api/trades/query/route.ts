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
  return NextResponse.json({ orders, positions, portfolio });
}
