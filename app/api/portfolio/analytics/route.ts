import { NextRequest, NextResponse } from "next/server";
import { summarizePortfolioPerformance } from "@/lib/portfolio/analytics";
import { loadPortfolioPerformanceSnapshots } from "@/lib/redis/coordination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.max(1, Math.min(5000, Number(req.nextUrl.searchParams.get("limit") ?? 1000)));
  try {
    const snapshots = await loadPortfolioPerformanceSnapshots(limit);
    return NextResponse.json({
      summary: summarizePortfolioPerformance(snapshots),
      snapshots
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Portfolio analytics snapshots are unavailable.",
        detail: error instanceof Error ? error.message : String(error),
        remediation: ["Start Redis and let paper fills, mark refreshes, or daemon ticks write performance snapshots."]
      },
      { status: 503 }
    );
  }
}
