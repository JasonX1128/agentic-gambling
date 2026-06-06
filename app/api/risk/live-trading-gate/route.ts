import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { boolEnv, getEnv, livePrerequisites } from "@/lib/config/env";
import { liveGateDecision } from "@/lib/risk/engine";
import { appendAuditEvent } from "@/lib/redis/coordination";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gateSchema = z.object({
  state: z.enum(["enabled", "disabled", "paused"]),
  reason: z.string().min(8)
});

export async function POST(req: NextRequest) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  const parsed = gateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid live gate request.", issues: parsed.error.issues }, { status: 400 });
  }
  const env = getEnv();
  const prerequisites = livePrerequisites(env);
  const decision = liveGateDecision({
    requestedMode: env.TRADING_MODE,
    enableLiveTrading: boolEnv(env.ENABLE_LIVE_TRADING),
    globalKillSwitch: boolEnv(env.GLOBAL_KILL_SWITCH),
    missingPrerequisites: prerequisites.missing
  });
  try {
    await appendAuditEvent({
      id: `audit-live-gate-${Date.now()}`,
      type: "live_gate",
      actor: "CopilotKit Live Gate Action",
      message: `Live gate requested=${parsed.data.state}; approved=${decision.approved}. ${parsed.data.reason}`,
      severity: decision.approved ? "success" : "warning",
      createdAt: new Date().toISOString(),
      payload: { request: parsed.data, decision }
    });
  } catch {
    // Audit failure cannot enable live trading.
  }
  return NextResponse.json(
    {
      requested: parsed.data,
      approved: decision.approved && parsed.data.state === "enabled",
      decision,
      message: decision.approved
        ? "Live prerequisites are satisfied; execution routes still require per-order approval tokens and risk/compliance checks."
        : "Live trading remains disabled."
    },
    { status: decision.approved ? 200 : 403 }
  );
}
