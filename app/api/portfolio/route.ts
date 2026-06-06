import { NextResponse } from "next/server";
import { getPortfolioSnapshot } from "@/lib/portfolio/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getPortfolioSnapshot());
}
