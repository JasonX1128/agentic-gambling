import type { ActivityEvent, Market, Opportunity, PortfolioSnapshot, SectorPod } from "@/lib/domain";
import { buildFundOperatingState } from "@/lib/agents/fund-management";
import { getOpportunities } from "@/lib/agents/orchestrator";
import { getPortfolioSnapshot } from "@/lib/portfolio/engine";
import { getMarkets } from "@/lib/services/market-service";
import { appendAuditEvent, enqueueTask } from "@/lib/redis/coordination";
import { traceAsync } from "@/lib/observability/weave";

export type ExecutiveCommitteeDecision = {
  id: string;
  podId: string;
  sector: string;
  action: "open_pod" | "maintain" | "expand" | "pip" | "defense" | "close_or_merge" | "sleep";
  analystTarget: number;
  riskBudgetAction: "allocate" | "hold" | "freeze" | "remove";
  rationale: string;
  createdAt: string;
};

export type ExecutiveCommitteeResult = {
  reviewedPods: number;
  decisions: ExecutiveCommitteeDecision[];
  createdAt: string;
};

export async function runExecutiveCommitteeReview(input?: {
  markets?: Market[];
  opportunities?: Opportunity[];
  portfolio?: PortfolioSnapshot;
  enqueueTask?: boolean;
}): Promise<ExecutiveCommitteeResult> {
  return traceAsync("agent.executive_committee", {}, async () => {
    const marketResult = input?.markets ? { markets: input.markets } : await getMarkets();
    const portfolio = input?.portfolio ?? (await getPortfolioSnapshot());
    const opportunities = input?.opportunities ?? (await getOpportunities());
    const state = buildFundOperatingState({
      markets: marketResult.markets,
      opportunities,
      portfolio
    });

    if (input?.enqueueTask ?? true) {
      await enqueueTask("executive-review", {
        kind: "executive_review",
        pods: String(state.pods.length),
        reviews: String(state.executiveReviews.length),
        createdAt: new Date().toISOString()
      });
    }

    const decisions = [
      ...state.pods.map(decisionForPod),
      ...state.podProposals
        .filter((proposal) => proposal.status === "proposed" || proposal.status === "incubating")
        .map((proposal) => ({
          id: `exec-open-${proposal.proposedPodId}-${Date.now()}`,
          podId: proposal.proposedPodId,
          sector: proposal.sector,
          action: "open_pod" as const,
          analystTarget: proposal.requiredAnalysts,
          riskBudgetAction: "allocate" as const,
          rationale: `Research scout proposal accepted for incubation: ${proposal.rationale}`,
          createdAt: new Date().toISOString()
        }))
    ];

    await appendAuditEvent(
      auditEvent(
        "agent_decision",
        "Executive Committee Loop",
        `Reviewed ${state.pods.length} pods; ${decisions.filter((decision) => decision.action !== "maintain").length} active governance actions.`,
        decisions.some((decision) => decision.action === "defense" || decision.action === "close_or_merge") ? "warning" : "info",
        { decisions: decisions.slice(0, 12) }
      )
    );

    return {
      reviewedPods: state.pods.length,
      decisions,
      createdAt: new Date().toISOString()
    };
  });
}

function decisionForPod(pod: SectorPod): ExecutiveCommitteeDecision {
  const now = new Date().toISOString();
  if (pod.lifecycleStatus === "defense") {
    return {
      id: `exec-defense-${pod.id}-${Date.now()}`,
      podId: pod.id,
      sector: pod.sector,
      action: "close_or_merge",
      analystTarget: pod.mandate.targetAnalystCount,
      riskBudgetAction: "freeze",
      rationale: `Pod is in defense with PnL $${pod.mandate.totalPnl} and mandate score ${pod.mandate.mandateScore}; freeze new risk until it defends edge, exits positions, or merges with a stronger pod.`,
      createdAt: now
    };
  }
  if (pod.lifecycleStatus === "pip") {
    return {
      id: `exec-pip-${pod.id}-${Date.now()}`,
      podId: pod.id,
      sector: pod.sector,
      action: "pip",
      analystTarget: pod.mandate.targetAnalystCount,
      riskBudgetAction: "hold",
      rationale: `Pod is on PIP; reduce analyst allocation and require a focused recovery thesis before scaling paper notional.`,
      createdAt: now
    };
  }
  if (pod.lifecycleStatus === "sleeping") {
    return {
      id: `exec-sleep-${pod.id}-${Date.now()}`,
      podId: pod.id,
      sector: pod.sector,
      action: "sleep",
      analystTarget: pod.mandate.targetAnalystCount,
      riskBudgetAction: "remove",
      rationale: "No active mandate or market depth; leave the pod asleep until scouts find viable markets.",
      createdAt: now
    };
  }
  if (pod.mandate.totalPnl > 0 && pod.approvedCandidates > 0 && pod.mandate.targetAnalystCount > pod.mandate.analystCount) {
    return {
      id: `exec-expand-${pod.id}-${Date.now()}`,
      podId: pod.id,
      sector: pod.sector,
      action: "expand",
      analystTarget: pod.mandate.targetAnalystCount,
      riskBudgetAction: "allocate",
      rationale: "Positive paper PnL and approved candidates support adding analyst capacity.",
      createdAt: now
    };
  }
  return {
    id: `exec-maintain-${pod.id}-${Date.now()}`,
    podId: pod.id,
    sector: pod.sector,
    action: "maintain",
    analystTarget: pod.mandate.targetAnalystCount,
    riskBudgetAction: pod.lifecycleStatus === "incubating" ? "allocate" : "hold",
    rationale: pod.mandate.executiveSummary,
    createdAt: now
  };
}

function auditEvent(
  type: ActivityEvent["type"],
  actor: string,
  message: string,
  severity: ActivityEvent["severity"],
  payload: Record<string, unknown>
): ActivityEvent {
  return {
    id: `audit-exec-${Date.now()}`,
    type,
    actor,
    message,
    severity,
    createdAt: new Date().toISOString(),
    payload
  };
}
