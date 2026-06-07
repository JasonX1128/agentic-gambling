import type { AgentNode, Opportunity, PortfolioSnapshot } from "@/lib/domain";
import {
  fallbackAgentPolicy,
  findPolicy,
  getAgentPolicies,
  getPaperCyclePolicy,
  policyForAgentNode
} from "@/lib/agents/operating-policy";
import { resolutionUrgencyScore } from "@/lib/quant/scoring";
import type { AgentPolicy } from "@/lib/agents/operating-policy";

export type { AgentPolicy };

export function agentPolicies(): AgentPolicy[] {
  return getAgentPolicies();
}

export function policyForRole(role: string): AgentPolicy {
  return findPolicy(role) ?? fallbackAgentPolicy(role);
}

export function hydrateAgentPolicy(agent: AgentNode): AgentNode {
  const policy = policyForAgentNode(agent);
  return {
    ...agent,
    operatingMode: policy.operatingMode,
    decisionRights: policy.decisionRights,
    systemPrompt: policy.systemPrompt
  };
}

export function paperCycleScore(opportunity: Opportunity, portfolio: PortfolioSnapshot): number {
  const scoring = getPaperCyclePolicy().scoring;
  const existingExposure = portfolio.sectorExposure[opportunity.sector] ?? 0;
  const directionalEdge = Math.abs(opportunity.forecast.expectedValue);
  const crowdingPenalty = Math.min(scoring.crowdingPenaltyMax, existingExposure / scoring.crowdingPenaltyDivisor);
  const negotiationPenalty = opportunity.risk.negotiableBlockedBy.length * scoring.negotiationPenalty;
  const urgencyBonus = resolutionUrgencyScore(opportunity.market) * scoring.resolutionUrgencyWeight;
  return (
    directionalEdge * scoring.directionalEdgeWeight +
    opportunity.forecast.confidence * scoring.confidenceWeight +
    opportunity.forecast.liquidityQuality * scoring.liquidityQualityWeight -
    opportunity.risk.riskScore * scoring.riskScorePenalty -
    crowdingPenalty -
    negotiationPenalty +
    urgencyBonus
  );
}

export function isPaperCycleEligible(opportunity: Opportunity): boolean {
  const eligibility = getPaperCyclePolicy().eligibility;
  if (eligibility.requireRiskApproved && !opportunity.risk.approved) return false;
  if (eligibility.requireComplianceApproved && !opportunity.compliance.approved) return false;
  if (eligibility.requirePositivePositionSize && opportunity.risk.positionSize <= 0) return false;
  return true;
}
