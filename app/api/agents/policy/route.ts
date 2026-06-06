import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  applyPolicyChange,
  evaluatePolicyChange,
  getAgentOperatingPolicy,
  getEditablePolicySections,
  getPolicyPath,
  policySummary,
  requiredPermissionForSection
} from "@/lib/agents/operating-policy";
import { appendAuditEvent } from "@/lib/redis/coordination";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const policyActionSchema = z.object({
  action: z.enum(["propose", "apply"]).default("propose"),
  actorRole: z.string().min(1),
  section: z.enum(["agentPolicies", "fundGovernance", "paperCycle", "executiveRoster"]),
  value: z.unknown(),
  reason: z.string().min(8)
});

export async function GET() {
  const policy = getAgentOperatingPolicy();
  return NextResponse.json({
    policy,
    summary: policySummary(policy),
    editableSections: getEditablePolicySections(),
    configPath: getPolicyPath()
  });
}

export async function POST(req: NextRequest) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  const parsed = policyActionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid policy change request.", issues: parsed.error.issues }, { status: 400 });
  }

  const mode = parsed.data.action;
  const changeRequest = {
    actorRole: parsed.data.actorRole,
    section: parsed.data.section,
    value: parsed.data.value,
    reason: parsed.data.reason
  };
  const evaluation = evaluatePolicyChange(changeRequest, mode);
  if (!evaluation.ok) {
    return NextResponse.json(
      {
        blocked: true,
        error: "POLICY_PERMISSION_OR_VALIDATION_FAILED",
        requiredPermission: evaluation.requiredPermission,
        reasons: evaluation.errors
      },
      { status: 403 }
    );
  }

  try {
    await appendAuditEvent({
      id: `audit-policy-${mode}-${Date.now()}`,
      type: "agent_decision",
      actor: parsed.data.actorRole,
      message:
        mode === "apply"
          ? `Applied operating-policy section ${parsed.data.section}. Reason: ${parsed.data.reason}`
          : `Proposed operating-policy section ${parsed.data.section}. Reason: ${parsed.data.reason}`,
      severity: mode === "apply" ? "warning" : "info",
      createdAt: new Date().toISOString(),
      payload: {
        action: mode,
        section: parsed.data.section,
        reason: parsed.data.reason,
        requiredPermission: evaluation.requiredPermission
      }
    });
  } catch {
    return NextResponse.json(
      {
        blocked: true,
        code: "REDIS_REQUIRED_FOR_POLICY_CHANGE",
        remediation: ["Start Redis so agent policy proposals and edits are auditable before changing the operating-policy file."]
      },
      { status: 503 }
    );
  }

  if (mode === "propose") {
    return NextResponse.json({
      status: "proposal_recorded",
      section: parsed.data.section,
      requiredPermissionForApply: requiredPermissionForSection(parsed.data.section),
      message: "Policy proposal was validated and audited. The policy file was not changed."
    });
  }

  const policy = await applyPolicyChange(changeRequest);
  return NextResponse.json({
    status: "applied",
    section: parsed.data.section,
    summary: policySummary(policy),
    policy
  });
}
