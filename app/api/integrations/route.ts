import { NextResponse } from "next/server";
import { staticIntegrationStatus } from "@/lib/config/env";
import { copilotKitHealth } from "@/lib/llm/health";
import { redisHealth } from "@/lib/redis/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const redis = await redisHealth();
  const copilotKit = await copilotKitHealth();
  return NextResponse.json(
    staticIntegrationStatus().map((status) => {
      if (status.name === "Redis") return redis;
      if (status.name === "CopilotKit") return copilotKit;
      return status;
    })
  );
}
