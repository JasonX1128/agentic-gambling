import type { ActivityEvent, PortfolioSnapshot } from "@/lib/domain";
import { getAgentAutomationConfig } from "@/lib/config/env";
import {
  applyPolicyChange,
  evaluatePolicyChange,
  getAgentOperatingPolicy,
  type PaperCyclePolicy
} from "@/lib/agents/operating-policy";
import { getPortfolioSnapshot } from "@/lib/portfolio/engine";
import { appendAuditEvent, enqueueTask } from "@/lib/redis/coordination";
import { traceAsync } from "@/lib/observability/weave";

export type PolicyLearningProposal = {
  id: string;
  actorRole: "Calibration Agent";
  section: "paperCycle";
  status: "proposed" | "applied" | "blocked" | "sleeping";
  reason: string;
  before: PaperCyclePolicy;
  after: PaperCyclePolicy;
  metrics: {
    orders: number;
    openPositions: number;
    settledTrades: number;
    totalPnl: number;
    brierScore: number;
    winRate: number;
  };
  errors: string[];
  createdAt: string;
};

export async function runAgentLearningLoop(options: { enqueueTask?: boolean } = {}): Promise<PolicyLearningProposal> {
  return traceAsync("agent.policy_learning", {}, async () => {
    const portfolio = await getPortfolioSnapshot();
    const policy = getAgentOperatingPolicy();
    const proposal = buildPaperCycleLearningProposal(portfolio, policy.paperCycle);

    if (options.enqueueTask ?? true) {
      await enqueueTask("policy-learning", {
        kind: "policy_learning",
        proposalId: proposal.id,
        status: proposal.status,
        createdAt: proposal.createdAt
      });
    }

    const evaluation = evaluatePolicyChange(
      {
        actorRole: proposal.actorRole,
        section: proposal.section,
        value: proposal.after,
        reason: proposal.reason
      },
      getAgentAutomationConfig().agentPolicyAutopilotApply ? "apply" : "propose",
      policy
    );

    if (!evaluation.ok) {
      const blocked = { ...proposal, status: "blocked" as const, errors: evaluation.errors };
      await appendAuditEvent(policyAudit(blocked));
      return blocked;
    }

    if (samePolicy(proposal.before, proposal.after)) {
      const sleeping = {
        ...proposal,
        status: "sleeping" as const,
        reason: "Calibration Agent found no policy change worth proposing on this tick."
      };
      await appendAuditEvent(policyAudit(sleeping));
      return sleeping;
    }

    if (getAgentAutomationConfig().agentPolicyAutopilotApply) {
      const appliedPolicy = await applyPolicyChange({
        actorRole: proposal.actorRole,
        section: proposal.section,
        value: proposal.after,
        reason: proposal.reason
      });
      const applied = { ...proposal, status: "applied" as const, after: appliedPolicy.paperCycle };
      await appendAuditEvent(policyAudit(applied));
      return applied;
    }

    await appendAuditEvent(policyAudit(proposal));
    return proposal;
  });
}

export function buildPaperCycleLearningProposal(
  portfolio: PortfolioSnapshot,
  current: PaperCyclePolicy,
  now = new Date()
): PolicyLearningProposal {
  const metrics = {
    orders: portfolio.orders.length,
    openPositions: portfolio.positions.length,
    settledTrades: portfolio.calibration.settledTrades,
    totalPnl: portfolio.totalPnl,
    brierScore: portfolio.calibration.brierScore,
    winRate: portfolio.calibration.winRate
  };
  const next: PaperCyclePolicy = JSON.parse(JSON.stringify(current)) as PaperCyclePolicy;
  let reason =
    "Calibration Agent proposes no-op paper-cycle policy after reviewing PnL, Brier score, win rate, order count, and open positions.";

  if (metrics.orders < 3 && metrics.openPositions < 3) {
    next.scoring.riskScorePenalty = round(Math.max(0.2, current.scoring.riskScorePenalty * 0.85));
    next.scoring.negotiationPenalty = round(Math.max(0, current.scoring.negotiationPenalty * 0.75));
    next.scoring.crowdingPenaltyMax = round(Math.max(0.5, current.scoring.crowdingPenaltyMax * 0.8));
    next.scoring.resolutionUrgencyWeight = round(Math.min(14, current.scoring.resolutionUrgencyWeight * 1.15));
    reason = "Calibration Agent loosens paper-cycle scoring because real paper volume is still too low for useful calibration.";
  } else if (metrics.settledTrades >= 3 && (metrics.brierScore > 0.28 || metrics.totalPnl < 0)) {
    next.scoring.confidenceWeight = round(current.scoring.confidenceWeight * 1.12);
    next.scoring.riskScorePenalty = round(current.scoring.riskScorePenalty * 1.15);
    next.scoring.directionalEdgeWeight = round(current.scoring.directionalEdgeWeight * 1.08);
    next.scoring.resolutionUrgencyWeight = round(Math.max(3, current.scoring.resolutionUrgencyWeight * 0.9));
    reason = "Calibration Agent tightens paper-cycle scoring because settled calibration or PnL is underperforming.";
  } else if (metrics.settledTrades >= 3 && metrics.winRate >= 0.55 && metrics.totalPnl >= 0) {
    next.scoring.directionalEdgeWeight = round(current.scoring.directionalEdgeWeight * 1.08);
    next.scoring.liquidityQualityWeight = round(current.scoring.liquidityQualityWeight * 1.05);
    next.scoring.negotiationPenalty = round(Math.max(0, current.scoring.negotiationPenalty * 0.9));
    next.scoring.resolutionUrgencyWeight = round(Math.min(14, current.scoring.resolutionUrgencyWeight * 1.05));
    reason = "Calibration Agent rewards the current profitable paper pattern while preserving risk/compliance gates.";
  }

  return {
    id: `policy-learning-${now.getTime()}`,
    actorRole: "Calibration Agent",
    section: "paperCycle",
    status: samePolicy(current, next) ? "sleeping" : "proposed",
    reason,
    before: current,
    after: next,
    metrics,
    errors: [],
    createdAt: now.toISOString()
  };
}

function policyAudit(proposal: PolicyLearningProposal): ActivityEvent {
  return {
    id: `audit-${proposal.id}`,
    type: "agent_decision",
    actor: "Calibration Agent",
    message:
      proposal.status === "sleeping"
        ? proposal.reason
        : `${proposal.status === "applied" ? "Applied" : proposal.status === "blocked" ? "Blocked" : "Proposed"} paper-cycle policy learning patch: ${proposal.reason}`,
    severity: proposal.status === "blocked" ? "warning" : proposal.status === "applied" ? "success" : "info",
    createdAt: new Date().toISOString(),
    payload: {
      proposalId: proposal.id,
      status: proposal.status,
      metrics: proposal.metrics,
      before: proposal.before.scoring,
      after: proposal.after.scoring,
      errors: proposal.errors
    }
  };
}

function samePolicy(left: PaperCyclePolicy, right: PaperCyclePolicy): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
