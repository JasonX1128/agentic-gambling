"use client";

import { useAgentContext, useFrontendTool } from "@copilotkit/react-core/v2/headless";
import type { JsonSerializable } from "@copilotkit/react-core/v2/headless";
import { z } from "zod";
import type { DemoRun, PaperCycleResult } from "@/lib/domain";

async function apiJson<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || response.statusText);
  }
  return response.json() as Promise<T>;
}

export function EventFundCopilotActions({ data }: { data: DemoRun }) {
  const contextValue: JsonSerializable = {
      mode: data.mode,
      marketSource: data.marketSource,
      marketBlocker: data.marketBlocker,
      portfolio: data.portfolio,
      opportunities: data.opportunities.map((opportunity) => ({
        id: opportunity.id,
        ticker: opportunity.market.ticker,
        title: opportunity.market.title,
        sector: opportunity.sector,
        closeTime: opportunity.market.closeTime,
        side: opportunity.side,
        expectedValue: opportunity.forecast.expectedValue,
        directionalEdge: Math.abs(opportunity.forecast.expectedValue),
        confidence: opportunity.forecast.confidence,
        riskApproved: opportunity.risk.approved,
        riskCounterOffer: opportunity.risk.counterOffer,
        hardBlockedBy: opportunity.risk.hardBlockedBy,
        negotiableBlockedBy: opportunity.risk.negotiableBlockedBy,
        complianceApproved: opportunity.compliance.approved,
        browserResearch: opportunity.browserResearch,
        status: opportunity.status
      })),
      pnl: {
        totalPnl: data.portfolio.totalPnl,
        unrealizedPnl: data.portfolio.unrealizedPnl,
        realizedPnl: data.portfolio.realizedPnl,
        closedPnl: data.portfolio.closedPnl,
        settledPnl: data.portfolio.settledPnl,
        calibration: data.portfolio.calibration
      },
      integrations: data.integrationStatus,
      fundAgents: data.fundAgents.map((agent) => ({
        name: agent.name,
        role: agent.role,
        status: agent.status,
        operatingMode: agent.operatingMode,
        decisionRights: agent.decisionRights,
        systemPrompt: agent.systemPrompt,
        lastDecision: agent.lastDecision
      })),
      pods: data.pods.map((pod) => ({
        id: pod.id,
        sector: pod.sector,
        lifecycleStatus: pod.lifecycleStatus,
        analystCount: pod.mandate.analystCount,
        targetAnalystCount: pod.mandate.targetAnalystCount,
        mandateScore: pod.mandate.mandateScore,
        capitalBudget: pod.mandate.capitalBudget,
        deployedCapital: pod.mandate.deployedCapital,
        availableBudget: pod.mandate.availableBudget,
        budgetUtilization: pod.mandate.budgetUtilization,
        budgetDecision: pod.mandate.budgetDecision,
        totalPnl: pod.mandate.totalPnl,
        realizedPnl: pod.mandate.realizedPnl,
        unrealizedPnl: pod.mandate.unrealizedPnl,
        activeMarkets: pod.activeMarkets,
        approvedCandidates: pod.approvedCandidates,
        nextReviewAt: pod.mandate.nextReviewAt,
        requiredDefense: pod.mandate.requiredDefense,
        actions: pod.mandate.actions,
        executiveSummary: pod.mandate.executiveSummary
      })),
      researchScouts: data.researchScouts,
      podProposals: data.podProposals,
      executiveReviews: data.executiveReviews,
      crossPodBriefings: data.crossPodBriefings,
      policySummary: data.policySummary
    } as unknown as JsonSerializable;

  useAgentContext({
    description:
      "EventFund OS compressed operating state: portfolio, opportunities, integration status, trading mode, risk/compliance status, dynamic pod mandates, research scouts, pod proposals, and executive reviews.",
    value: contextValue
  });

  useFrontendTool({
    name: "queryTrades",
    description: "Query EventFund trades by status, ticker, sector, or source.",
    parameters: z.object({
      status: z.string().optional(),
      ticker: z.string().optional(),
      sector: z.string().optional()
    }),
    handler: async (args, { signal }) =>
      apiJson("/api/trades/query", {
        method: "POST",
        body: JSON.stringify(args)
      }, signal)
  });

  useFrontendTool({
    name: "explainRecommendation",
    description: "Explain why an EventFund OS trade recommendation is attractive and what would break it.",
    parameters: z.object({ recommendationId: z.string() }),
    handler: async ({ recommendationId }, { signal }) =>
      apiJson(`/api/recommendations/${encodeURIComponent(recommendationId)}/explain`, undefined, signal)
  });

  useFrontendTool({
    name: "runBrowserResearchForTrade",
    description:
      "Run the Browser Research Agent for a recommendation. It uses the configured public browser harness and sportsbook odds feed to attach evidence and fair-pricing context before trade approval.",
    parameters: z.object({ recommendationId: z.string() }),
    handler: async ({ recommendationId }, { signal }) =>
      apiJson(`/api/research/browser/${encodeURIComponent(recommendationId)}`, {
        method: "POST",
        body: JSON.stringify({})
      }, signal)
  });

  useFrontendTool({
    name: "changeRiskLimit",
    description: "Request a risk limit change. Server validates and audits the request; it cannot bypass risk policy.",
    parameters: z.object({
      limitType: z.enum([
        "maxDailyLoss",
        "maxPositionSize",
        "maxSectorExposure",
        "minLiquidity",
        "minConfidence",
        "maxDrawdown"
      ]),
      value: z.number(),
      reason: z.string()
    }),
    handler: async (args, { signal }) =>
      apiJson("/api/risk/limits", {
        method: "POST",
        body: JSON.stringify(args)
      }, signal)
  });

  useFrontendTool({
    name: "filterOpportunities",
    description: "Filter opportunity results by confidence, liquidity, sector, or blocked status.",
    parameters: z.object({
      minConfidence: z.number().optional(),
      minLiquidity: z.number().optional(),
      sector: z.string().optional(),
      includeBlocked: z.boolean().optional()
    }),
    handler: async (args, { signal }) =>
      apiJson(
        `/api/opportunities?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(args as Record<string, string | number | boolean | undefined>)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [key, String(value)])
          )
        ).toString()}`,
        undefined,
        signal
      )
  });

  useFrontendTool({
    name: "generateCioMemo",
    description: "Generate a CIO-ready memo from selected EventFund OS opportunities.",
    parameters: z.object({
      opportunityIds: z.array(z.string()).optional(),
      tone: z.enum(["brief", "committee", "full"]).optional()
    }),
    handler: async (args, { signal }) =>
      apiJson("/api/memos/cio", {
        method: "POST",
        body: JSON.stringify(args)
      }, signal)
  });

  useFrontendTool({
    name: "approvePaperTrade",
    description:
      "Execute a paper trade after server-side risk/compliance checks. This never sends an order to Kalshi, but it does mutate the paper portfolio.",
    parameters: z.object({ opportunityId: z.string() }),
    handler: async ({ opportunityId }, { signal }) =>
      apiJson(`/api/trades/${encodeURIComponent(opportunityId)}/approve`, {
        method: "POST",
        body: JSON.stringify({ source: "copilot" })
      }, signal)
  });

  useFrontendTool({
    name: "closePaperPosition",
    description: "Close an open paper position at an explicit paper exit price, realizing closed PnL.",
    parameters: z.object({
      ticker: z.string(),
      exitPrice: z.number().min(0).max(100).optional(),
      quantity: z.number().int().positive().optional(),
      reason: z.string().optional()
    }),
    handler: async ({ ticker, ...body }, { signal }) =>
      apiJson(`/api/trades/${encodeURIComponent(ticker)}/close`, {
        method: "POST",
        body: JSON.stringify({ ...body, source: "copilot" })
      }, signal)
  });

  useFrontendTool({
    name: "settlePaperPosition",
    description: "Record a paper settlement outcome, move the position to settled PnL, and update Brier/calibration metrics.",
    parameters: z.object({
      ticker: z.string(),
      outcome: z.enum(["yes", "no"]),
      notes: z.string().optional()
    }),
    handler: async ({ ticker, ...body }, { signal }) =>
      apiJson(`/api/trades/${encodeURIComponent(ticker)}/settle`, {
        method: "POST",
        body: JSON.stringify({ ...body, source: "copilot" })
      }, signal)
  });

  useFrontendTool({
    name: "refreshPaperMarks",
    description: "Refresh open paper position marks from current Kalshi market data and recompute unrealized PnL.",
    parameters: z.object({}),
    handler: async (_args, { signal }) =>
      apiJson("/api/portfolio/mark-to-market", {
        method: "POST",
        body: JSON.stringify({})
      }, signal)
  });

  useFrontendTool({
    name: "runAgentPaperCycle",
    description:
      "Ask the CIO, CRO, Compliance, Research, and Execution agents to select and place the current paper-trading slate.",
    parameters: z.object({}),
    handler: async (_args, { signal }) =>
      apiJson<PaperCycleResult>("/api/agents/paper-cycle", {
        method: "POST",
        body: JSON.stringify({})
      }, signal)
  });

  useFrontendTool({
    name: "runContinuousPaperDaemonTick",
    description:
      "Run one locked continuous paper-trading daemon tick: scan Kalshi markets, mark paper positions, enqueue worker tasks, run one worker batch, and audit the result.",
    parameters: z.object({}),
    handler: async (_args, { signal }) =>
      apiJson("/api/agents/daemon/tick", {
        method: "POST",
        body: JSON.stringify({})
      }, signal)
  });

  useFrontendTool({
    name: "runRedisFundWorkersOnce",
    description:
      "Consume one bounded batch from the Redis Stream worker queues for research, risk, execution, reconciliation, policy learning, and executive review.",
    parameters: z.object({}),
    handler: async (_args, { signal }) =>
      apiJson("/api/agents/workers/run-once", {
        method: "POST",
        body: JSON.stringify({})
      }, signal)
  });

  useFrontendTool({
    name: "runAgentLearningProposal",
    description:
      "Ask the Calibration Agent to inspect paper PnL/calibration and propose a permissioned paper-cycle policy patch.",
    parameters: z.object({}),
    handler: async (_args, { signal }) =>
      apiJson("/api/agents/learning/propose", {
        method: "POST",
        body: JSON.stringify({})
      }, signal)
  });

  useFrontendTool({
    name: "runPaperSettlementReconciliation",
    description:
      "Poll Kalshi market detail for open paper positions and auto-settle only when the market is settled and the outcome is inferable.",
    parameters: z.object({}),
    handler: async (_args, { signal }) =>
      apiJson("/api/agents/reconciliation/run", {
        method: "POST",
        body: JSON.stringify({})
      }, signal)
  });

  useFrontendTool({
    name: "runExecutiveCommitteeReview",
    description:
      "Run the executive committee loop to open, expand, PIP, freeze, merge, close, or sleep sector pods based on paper PnL and mandate score.",
    parameters: z.object({}),
    handler: async (_args, { signal }) =>
      apiJson("/api/agents/executive-review/run", {
        method: "POST",
        body: JSON.stringify({})
      }, signal)
  });

  useFrontendTool({
    name: "queryPodGovernance",
    description: "Inspect dynamic pod mandates, research scouts, pod proposals, and executive PIP/defense reviews.",
    parameters: z.object({}),
    handler: async (_args, { signal }) => apiJson("/api/agents/governance", undefined, signal)
  });

  useFrontendTool({
    name: "readAgentOperatingPolicy",
    description: "Read the file-backed agent operating policy, editable sections, permissions, prompts, pod rules, and CIO paper-cycle scoring.",
    parameters: z.object({}),
    handler: async (_args, { signal }) => apiJson("/api/agents/policy", undefined, signal)
  });

  useFrontendTool({
    name: "proposeAgentPolicyPatch",
    description:
      "Propose a JSON replacement for one editable operating-policy section. This records an audited proposal but does not write the policy file.",
    parameters: z.object({
      actorRole: z.string(),
      section: z.enum(["agentPolicies", "fundGovernance", "paperCycle", "executiveRoster"]),
      reason: z.string(),
      valueJson: z.string()
    }),
    handler: async ({ valueJson, ...args }, { signal }) =>
      apiJson("/api/agents/policy", {
        method: "POST",
        body: JSON.stringify({ ...args, action: "propose", value: JSON.parse(valueJson) })
      }, signal)
  });

  useFrontendTool({
    name: "applyAgentPolicyPatch",
    description:
      "Apply a JSON replacement for one editable operating-policy section when the actor role has permission and Redis audit succeeds.",
    parameters: z.object({
      actorRole: z.string(),
      section: z.enum(["agentPolicies", "fundGovernance", "paperCycle", "executiveRoster"]),
      reason: z.string(),
      valueJson: z.string()
    }),
    handler: async ({ valueJson, ...args }, { signal }) =>
      apiJson("/api/agents/policy", {
        method: "POST",
        body: JSON.stringify({ ...args, action: "apply", value: JSON.parse(valueJson) })
      }, signal)
  });

  useFrontendTool({
    name: "setLiveTradingGate",
    description:
      "Request live-trading gate state. Server will deny unless live mode, Kalshi credentials, risk limits, and kill switch state all pass.",
    parameters: z.object({
      state: z.enum(["enabled", "disabled", "paused"]),
      reason: z.string()
    }),
    handler: async (args, { signal }) =>
      apiJson("/api/risk/live-trading-gate", {
        method: "POST",
        body: JSON.stringify(args)
      }, signal)
  });

  return null;
}
