import fs from "fs";
import path from "path";
import { z } from "zod";
import type { AgentNode, PodLifecycleStatus } from "@/lib/domain";

export type PolicyPermission =
  | "read_policy"
  | "propose_policy_patch"
  | "apply_prompt_policy"
  | "apply_governance_policy"
  | "apply_paper_cycle_policy";

export type EditablePolicySection = "agentPolicies" | "fundGovernance" | "paperCycle";

const operatingModeSchema = z.enum(["discover", "debate", "negotiate", "approve", "execute", "monitor"]);

export const agentPolicySchema = z.object({
  role: z.string().min(1),
  operatingMode: operatingModeSchema,
  decisionRights: z.array(z.string().min(1)).min(1),
  systemPrompt: z.string().min(12)
});

const sectorRuleSchema = z.object({
  sector: z.string().min(1),
  matchAny: z.array(z.string().min(1)).default([]),
  sectorEquals: z.array(z.string().min(1)).optional(),
  categoryEquals: z.array(z.string().min(1)).optional(),
  priority: z.number().optional()
});

const lifecycleStatusSchema = z.enum(["scouting", "incubating", "active", "pip", "defense", "sleeping", "closed"]);

const fundGovernanceSchema = z.object({
  analystRoles: z.array(z.string().min(1)).min(1),
  sectorClassificationRules: z.array(sectorRuleSchema),
  mandateScoring: z.object({
    base: z.number(),
    pnlMultiplier: z.number(),
    approvedOpportunityWeight: z.number(),
    marketWeight: z.number(),
    blockedPenalty: z.number(),
    exposurePenaltyThreshold: z.number(),
    exposurePenaltyDivisor: z.number().positive(),
    minScore: z.number(),
    maxScore: z.number()
  }),
  lifecycleThresholds: z.object({
    defensePnl: z.number(),
    defenseScore: z.number(),
    pipPnl: z.number(),
    pipScore: z.number(),
    incubatingApprovedOpportunities: z.number().nonnegative(),
    incubatingScore: z.number()
  }),
  reviewHours: z.object({
    defense: z.number().positive(),
    pip: z.number().positive(),
    sleeping: z.number().positive(),
    default: z.number().positive(),
    scoutNoMarkets: z.number().positive(),
    scoutInvestigating: z.number().positive(),
    proposalSleep: z.number().positive()
  }),
  analystCounts: z.object({
    sleeping: z.object({ current: z.number().nonnegative(), target: z.number().nonnegative() }),
    defense: z.object({ current: z.number().nonnegative(), target: z.number().nonnegative() }),
    pip: z.object({ current: z.number().nonnegative(), target: z.number().nonnegative() }),
    incubating: z.object({
      base: z.number().nonnegative(),
      approvedMultiplier: z.number().nonnegative(),
      max: z.number().positive(),
      targetMax: z.number().positive()
    }),
    active: z.object({
      base: z.number().nonnegative(),
      min: z.number().nonnegative(),
      max: z.number().positive(),
      approvedMultiplier: z.number().nonnegative(),
      marketsDivisor: z.number().positive(),
      positivePnlBonusThreshold: z.number(),
      positivePnlBonus: z.number().nonnegative(),
      targetBase: z.number().nonnegative(),
      targetMax: z.number().positive()
    })
  }),
  mandateActions: z.record(lifecycleStatusSchema, z.array(z.string().min(1))).and(
    z.object({
      active: z.array(z.string().min(1)),
      scouting: z.array(z.string().min(1)),
      incubating: z.array(z.string().min(1)),
      pip: z.array(z.string().min(1)),
      defense: z.array(z.string().min(1)),
      sleeping: z.array(z.string().min(1))
    })
  ),
  requiredDefenseItems: z.array(z.string().min(1)),
  executiveReviewQuestions: z.array(z.string().min(1)).min(1),
  executiveReviewDecisions: z.object({
    defense: z.string().min(1),
    pip: z.string().min(1)
  }),
  proposalPolicy: z.object({
    baseConfidence: z.number(),
    approvedWeight: z.number(),
    marketWeight: z.number(),
    mandateScoreDivisor: z.number().positive(),
    minConfidence: z.number(),
    maxConfidence: z.number(),
    proposalThreshold: z.number(),
    risks: z.array(z.string().min(1))
  }),
  scoutMessages: z.object({
    noMarkets: z.string().min(1),
    investigating: z.string().min(1),
    sleeping: z.string().min(1)
  }),
  podAgentMessages: z.object({
    sleeping: z.string().min(1),
    defense: z.string().min(1),
    pip: z.string().min(1),
    incubating: z.string().min(1),
    active: z.string().min(1)
  }),
  thesisTemplates: z.object({
    approved: z.string().min(1),
    markets: z.string().min(1),
    none: z.string().min(1)
  }),
  executiveSummaryTemplates: z.object({
    defense: z.string().min(1),
    pip: z.string().min(1),
    incubating: z.string().min(1),
    sleeping: z.string().min(1),
    active: z.string().min(1),
    scouting: z.string().min(1)
  })
});

const paperCycleSchema = z.object({
  eligibility: z.object({
    requireRiskApproved: z.boolean(),
    requireComplianceApproved: z.boolean(),
    requirePositivePositionSize: z.boolean()
  }),
  scoring: z.object({
    directionalEdgeWeight: z.number(),
    confidenceWeight: z.number(),
    liquidityQualityWeight: z.number(),
    riskScorePenalty: z.number(),
    crowdingPenaltyMax: z.number(),
    crowdingPenaltyDivisor: z.number().positive(),
    negotiationPenalty: z.number()
  })
});

export const agentOperatingPolicySchema = z.object({
  version: z.string().min(1),
  updatedAt: z.string().min(1),
  safety: z.object({
    agentEditable: z.literal(false),
    protectedSections: z.array(z.string().min(1)),
    protectedKeys: z.array(z.string().min(1)),
    liveTradingEditPolicy: z.string().min(1)
  }),
  permissions: z.object({
    roles: z.record(z.array(z.enum([
      "read_policy",
      "propose_policy_patch",
      "apply_prompt_policy",
      "apply_governance_policy",
      "apply_paper_cycle_policy"
    ])))
  }),
  agentPolicies: z.array(agentPolicySchema).min(1),
  fundGovernance: fundGovernanceSchema,
  paperCycle: paperCycleSchema
});

export type AgentPolicy = z.infer<typeof agentPolicySchema>;
export type AgentOperatingPolicy = z.infer<typeof agentOperatingPolicySchema>;
export type FundGovernancePolicy = AgentOperatingPolicy["fundGovernance"];
export type PaperCyclePolicy = AgentOperatingPolicy["paperCycle"];

export type PolicyChangeRequest = {
  actorRole: string;
  section: EditablePolicySection;
  value: unknown;
  reason: string;
};

export type PolicyEvaluation =
  | {
      ok: true;
      requiredPermission: PolicyPermission;
      nextPolicy: AgentOperatingPolicy;
    }
  | {
      ok: false;
      requiredPermission?: PolicyPermission;
      errors: string[];
    };

const editableSections: EditablePolicySection[] = ["agentPolicies", "fundGovernance", "paperCycle"];
const policyPath = path.join(process.cwd(), "config", "agent-operating-policy.json");

const fallbackPolicy: AgentOperatingPolicy = {
  version: "fallback.agent-operating-policy",
  updatedAt: new Date(0).toISOString(),
  safety: {
    agentEditable: false,
    protectedSections: ["safety", "permissions", "liveTradingPrerequisites", "secrets", "hardComplianceProhibitions"],
    protectedKeys: ["TRADING_MODE", "ENABLE_LIVE_TRADING", "GLOBAL_KILL_SWITCH", "KALSHI_API_KEY", "KALSHI_API_SECRET"],
    liveTradingEditPolicy:
      "Agents may tune research, prompt, scoring, pod lifecycle, and paper-cycle policy, but cannot self-enable live trading."
  },
  permissions: {
    roles: {
      "CTO Agent": ["read_policy", "propose_policy_patch", "apply_prompt_policy", "apply_governance_policy", "apply_paper_cycle_policy"],
      "CIO / Senior PM Agent": ["read_policy", "propose_policy_patch", "apply_prompt_policy", "apply_governance_policy", "apply_paper_cycle_policy"],
      "Research Director Agent": ["read_policy", "propose_policy_patch", "apply_prompt_policy", "apply_governance_policy"],
      "Chief Risk Officer Agent": ["read_policy", "propose_policy_patch", "apply_governance_policy", "apply_paper_cycle_policy"],
      "Calibration Agent": ["read_policy", "propose_policy_patch", "apply_paper_cycle_policy"]
    }
  },
  agentPolicies: [
    {
      role: "CIO / Senior PM Agent",
      operatingMode: "approve",
      decisionRights: ["Rank cross-sector opportunities", "Allocate paper risk budget", "Send approved slate to execution"],
      systemPrompt:
        "You are the fund CIO. Maximize risk-adjusted paper PnL through many small, observable experiments. Never override Risk or Compliance hard stops."
    }
  ],
  fundGovernance: {
    analystRoles: ["Data Analyst", "News Analyst", "Rules Analyst", "Market Microstructure Analyst", "Contrarian Agent", "Calibration Agent"],
    sectorClassificationRules: [],
    mandateScoring: {
      base: 45,
      pnlMultiplier: 2,
      approvedOpportunityWeight: 8,
      marketWeight: 3,
      blockedPenalty: 5,
      exposurePenaltyThreshold: 250,
      exposurePenaltyDivisor: 20,
      minScore: 0,
      maxScore: 100
    },
    lifecycleThresholds: {
      defensePnl: -25,
      defenseScore: 25,
      pipPnl: 0,
      pipScore: 40,
      incubatingApprovedOpportunities: 2,
      incubatingScore: 60
    },
    reviewHours: {
      defense: 6,
      pip: 12,
      sleeping: 24,
      default: 4,
      scoutNoMarkets: 6,
      scoutInvestigating: 4,
      proposalSleep: 12
    },
    analystCounts: {
      sleeping: { current: 1, target: 0 },
      defense: { current: 3, target: 2 },
      pip: { current: 4, target: 3 },
      incubating: { base: 3, approvedMultiplier: 1, max: 7, targetMax: 6 },
      active: {
        base: 4,
        min: 5,
        max: 10,
        approvedMultiplier: 1,
        marketsDivisor: 4,
        positivePnlBonusThreshold: 10,
        positivePnlBonus: 1,
        targetBase: 5,
        targetMax: 10
      }
    },
    mandateActions: {
      active: ["Continue scan", "Defend edge with PnL", "Refresh marks before next allocation"],
      scouting: ["Map market cluster", "Draft pod proposal", "Wait for risk-approved paper candidates"],
      incubating: ["Assign seed analysts", "Run paper probes", "Escalate if first samples survive risk review"],
      pip: ["Cut analyst count", "Reduce position size", "Show next falsifiable public-data edge"],
      defense: ["Freeze scale-ups", "Write defense memo", "Close or settle stale positions"],
      sleeping: ["Sleep research loop", "Wake when new Kalshi markets or material public catalysts appear"],
      closed: ["Keep mandate closed"]
    },
    requiredDefenseItems: ["PnL attribution", "Thesis failure analysis", "Prompt/sizing changes", "Next probe budget"],
    executiveReviewQuestions: [
      "What public edge remains after observed losses?",
      "Which analyst call was wrong, and what changed in the prompt or sizing policy?",
      "What is the next smallest falsifiable paper probe?"
    ],
    executiveReviewDecisions: {
      defense: "Executive committee requires a defense memo before more risk budget.",
      pip: "Pod is on PIP: reduce analyst count, cut size, and prove edge with smaller paper samples."
    },
    proposalPolicy: {
      baseConfidence: 0.35,
      approvedWeight: 0.12,
      marketWeight: 0.04,
      mandateScoreDivisor: 250,
      minConfidence: 0.2,
      maxConfidence: 0.95,
      proposalThreshold: 0.55,
      risks: ["Thin liquidity can produce false paper edge", "Settlement rules must stay machine-readable"]
    },
    scoutMessages: {
      noMarkets: "No Kalshi markets available for a new pod proposal.",
      investigating: "Still investigating; no executive-ready pod proposal yet.",
      sleeping: "No fresh markets; sleeping before next sector sweep."
    },
    podAgentMessages: {
      sleeping: "No actionable pod proposal; sleeping until {reviewTime}.",
      defense: "Defending mandate to executives: total PnL ${pnl}, score {score}.",
      pip: "On PIP: shrink risk, explain losses, and prove {podKey} still deserves analysts.",
      incubating: "Incubating new pod with small paper probes before full mandate.",
      active: "Running continuous market scan, debate, and risk negotiation."
    },
    thesisTemplates: {
      approved: "{podKey} has {approved} risk-approved paper candidates across {markets} live Kalshi markets.",
      markets: "{podKey} has live markets but needs a stronger public-data edge before a full pod mandate.",
      none: "{podKey} has no current market coverage and should sleep until new markets appear."
    },
    executiveSummaryTemplates: {
      defense: "{podKey} must defend existence: PnL ${pnl}, mandate score {score}.",
      pip: "{podKey} is on PIP: PnL ${pnl}, mandate score {score}, reduced analysts.",
      incubating: "{podKey} is proposed for incubation with small paper risk and limited analysts.",
      sleeping: "{podKey} research is sleeping until new evidence or markets justify attention.",
      active: "{podKey} mandate is active and must continue proving edge through PnL and calibration.",
      scouting: "{podKey} is scouting and needs a public-data edge before capital allocation."
    }
  },
  paperCycle: {
    eligibility: {
      requireRiskApproved: true,
      requireComplianceApproved: true,
      requirePositivePositionSize: true
    },
    scoring: {
      directionalEdgeWeight: 100,
      confidenceWeight: 20,
      liquidityQualityWeight: 15,
      riskScorePenalty: 0.4,
      crowdingPenaltyMax: 20,
      crowdingPenaltyDivisor: 20,
      negotiationPenalty: 2.5
    }
  }
};

export function getAgentOperatingPolicy(): AgentOperatingPolicy {
  try {
    const raw = fs.readFileSync(policyPath, "utf8");
    return agentOperatingPolicySchema.parse(JSON.parse(raw));
  } catch {
    return fallbackPolicy;
  }
}

export function getAgentPolicies(): AgentPolicy[] {
  return getAgentOperatingPolicy().agentPolicies;
}

export function getFundGovernancePolicy(): FundGovernancePolicy {
  return getAgentOperatingPolicy().fundGovernance;
}

export function getPaperCyclePolicy(): PaperCyclePolicy {
  return getAgentOperatingPolicy().paperCycle;
}

export function getPolicyPath(): string {
  return policyPath;
}

export function getEditablePolicySections(): EditablePolicySection[] {
  return [...editableSections];
}

export function canRole(actorRole: string, permission: PolicyPermission, policy = getAgentOperatingPolicy()): boolean {
  return (policy.permissions.roles[actorRole] ?? []).includes(permission);
}

export function requiredPermissionForSection(section: EditablePolicySection): PolicyPermission {
  if (section === "agentPolicies") return "apply_prompt_policy";
  if (section === "paperCycle") return "apply_paper_cycle_policy";
  return "apply_governance_policy";
}

export function evaluatePolicyChange(
  request: PolicyChangeRequest,
  mode: "propose" | "apply",
  policy = getAgentOperatingPolicy()
): PolicyEvaluation {
  if (!editableSections.includes(request.section)) {
    return { ok: false, errors: [`Section ${request.section} is protected or unknown.`] };
  }
  const permission = mode === "apply" ? requiredPermissionForSection(request.section) : "propose_policy_patch";
  if (!canRole(request.actorRole, permission, policy)) {
    return {
      ok: false,
      requiredPermission: permission,
      errors: [`${request.actorRole} does not have ${permission}.`]
    };
  }
  if (request.reason.trim().length < 8) {
    return { ok: false, requiredPermission: permission, errors: ["Policy changes require an explicit reason."] };
  }
  const candidate = {
    ...policy,
    [request.section]: request.value,
    updatedAt: new Date().toISOString()
  };
  const parsed = agentOperatingPolicySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      requiredPermission: permission,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    };
  }
  return { ok: true, requiredPermission: permission, nextPolicy: parsed.data };
}

export async function applyPolicyChange(request: PolicyChangeRequest): Promise<AgentOperatingPolicy> {
  const evaluation = evaluatePolicyChange(request, "apply");
  if (!evaluation.ok) {
    throw new Error(evaluation.errors.join(" "));
  }
  await fs.promises.writeFile(policyPath, `${JSON.stringify(evaluation.nextPolicy, null, 2)}\n`, "utf8");
  return evaluation.nextPolicy;
}

export function policySummary(policy = getAgentOperatingPolicy()) {
  return {
    version: policy.version,
    updatedAt: policy.updatedAt,
    configPath: policyPath,
    editableSections: editableSections,
    protectedSections: policy.safety.protectedSections,
    protectedKeys: policy.safety.protectedKeys,
    liveTradingEditPolicy: policy.safety.liveTradingEditPolicy,
    permissionedRoles: Object.keys(policy.permissions.roles).length,
    agentPolicyCount: policy.agentPolicies.length,
    sectorRuleCount: policy.fundGovernance.sectorClassificationRules.length,
    paperCycleScoring: policy.paperCycle.scoring
  };
}

export function policyForAgentNode(agent: AgentNode): AgentPolicy {
  return findPolicy(agent.name) ?? findPolicy(agent.role) ?? fallbackAgentPolicy(agent.role);
}

export function findPolicy(label: string): AgentPolicy | undefined {
  return getAgentPolicies().find((policy) => policy.role === label);
}

export function fallbackAgentPolicy(role: string): AgentPolicy {
  return {
    role,
    operatingMode: "debate",
    decisionRights: ["Participate in debate", "Escalate uncertainty"],
    systemPrompt: "Participate as a cautious event-trading agent. Use public evidence and respect risk/compliance gates."
  };
}

export function actionsForLifecycle(status: PodLifecycleStatus, policy = getFundGovernancePolicy()): string[] {
  return policy.mandateActions[status] ?? policy.mandateActions.active;
}
