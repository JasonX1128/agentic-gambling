import { NextResponse } from "next/server";
import { demoActivity } from "@/lib/data/seeds";
import { getAuditEvents } from "@/lib/redis/coordination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await getAuditEvents();
    return NextResponse.json({ events: events.length ? events : demoActivity });
  } catch (error) {
    return NextResponse.json({
      events: demoActivity,
      blocker: error instanceof Error ? error.message : String(error)
    });
  }
}
