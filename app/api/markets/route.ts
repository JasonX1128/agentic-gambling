import { NextResponse } from "next/server";
import { getMarkets } from "@/lib/services/market-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getMarkets());
}
