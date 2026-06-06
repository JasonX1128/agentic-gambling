import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRiskLimits } from "@/lib/config/env";
import { appendAuditEvent } from "@/lib/redis/coordination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const changeSchema = z.object({
  limitType: z.enum(["maxDailyLoss", "maxPositionSize", "maxSectorExposure", "minLiquidity", "minConfidence", "maxDrawdown"]),
  value: z.number().positive(),
  reason: z.string().min(8)
});

export async function GET() {
  return NextResponse.json(getRiskLimits());
}

export async function POST(req: NextRequest) {
  const parsed = changeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid risk limit change request.", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    await appendAuditEvent({
      id: `audit-risk-${Date.now()}`,
      type: "risk_check",
      actor: "CopilotKit Risk Action",
      message: `Requested ${parsed.data.limitType} change to ${parsed.data.value}. Reason: ${parsed.data.reason}`,
      severity: "warning",
      createdAt: new Date().toISOString(),
      payload: parsed.data
    });
  } catch {
    // Limit changes are not applied without Redis-backed auditability.
    return NextResponse.json(
      {
        blocked: true,
        code: "REDIS_REQUIRED_FOR_RISK_CHANGE",
        remediation: ["Start Redis so risk changes are auditable before applying them."]
      },
      { status: 503 }
    );
  }
  return NextResponse.json({
    status: "review_required",
    message: "Risk limit change captured for human review. Runtime env values were not mutated by CopilotKit."
  });
}
