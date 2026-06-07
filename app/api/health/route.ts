import { NextResponse } from "next/server";
import { getAgentAutomationConfig, getEnv, getTradingMode, livePrerequisites, staticIntegrationStatus } from "@/lib/config/env";
import { copilotKitHealth } from "@/lib/llm/health";
import { redisHealth } from "@/lib/redis/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [redis, copilotKit] = await Promise.all([redisHealth(), copilotKitHealth()]);
  const env = getEnv();
  const live = livePrerequisites(env);
  const automation = getAgentAutomationConfig();
  const integrations = staticIntegrationStatus().map((status) => {
    if (status.name === "Redis") return redis;
    if (status.name === "CopilotKit") return copilotKit;
    return status;
  });
  const blockers = integrations.filter((status) => status.state === "blocked").map((status) => status.name);
  const readiness = blockers.length ? "blocked" : "ready";

  return NextResponse.json(
    {
      service: "eventfund-os",
      liveness: "ok",
      readiness,
      mode: getTradingMode(),
      deploySha:
        process.env.EVENTFUND_DEPLOY_SHA ??
        process.env.RAILWAY_GIT_COMMIT_SHA ??
        process.env.RENDER_GIT_COMMIT ??
        process.env.FLY_IMAGE_REF ??
        "local",
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: new Date().toISOString(),
      blockers,
      liveReadiness: {
        ready: live.ok,
        missing: live.missing,
        dryRunPreviewRoute: "/api/trades/[id]/live-preview",
        liveExecutionRoute: "/api/trades/[id]/execute"
      },
      accessControl: {
        operatorAuthRequired: automation.operatorAuthRequired,
        operatorAuthConfigured: automation.operatorAuthConfigured
      },
      integrations
    },
    { status: readiness === "ready" ? 200 : 503 }
  );
}
