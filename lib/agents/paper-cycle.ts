import type { ActivityEvent, Market, Opportunity, PaperCycleResult, PortfolioSnapshot, SectorPod, TradeOrder } from "@/lib/domain";
import { getPaperCycleConfig } from "@/lib/config/env";
import { getOpportunities } from "@/lib/agents/orchestrator";
import { buildFundOperatingState, classifyPodSector } from "@/lib/agents/fund-management";
import { getFundGovernancePolicy } from "@/lib/agents/operating-policy";
import { isPaperCycleEligible, paperCycleScore } from "@/lib/agents/policy";
import { approvePaperTrade } from "@/lib/execution/engine";
import { getPortfolioSnapshot } from "@/lib/portfolio/engine";
import { appendAuditEvent, enqueueTask, saveOpportunity } from "@/lib/redis/coordination";
import { traceAsync } from "@/lib/observability/weave";

type SlateItem = {
  opportunity: Opportunity;
  score: number;
};

export function selectPaperCycleSlate(
  opportunities: Opportunity[],
  portfolio: PortfolioSnapshot,
  maxTrades: number,
  minCycleScore: number
): SlateItem[] {
  const alreadyTraded = agentPaperTradesToday(portfolio);
  const positionedTickers = new Set(portfolio.positions.map((position) => position.ticker));
  const candidates = opportunities
    .filter(isPaperCycleEligible)
    .filter((opportunity) => !alreadyTraded.has(opportunity.id))
    .filter((opportunity) => !positionedTickers.has(opportunity.market.ticker))
    .map((opportunity) => ({
      opportunity,
      score: paperCycleScore(opportunity, portfolio)
    }))
    .filter((item) => item.score >= minCycleScore)
    .sort((a, b) => b.score - a.score);
  const state = buildFundOperatingState({
    markets: uniqueMarkets(opportunities.map((opportunity) => opportunity.market)),
    opportunities,
    portfolio
  });
  const podBySector = new Map(state.pods.map((pod) => [pod.sector, pod]));
  const selected: SlateItem[] = [];
  const selectedIds = new Set<string>();
  const deployments = new Map<string, { trades: number; notional: number }>();

  const addIfBudgeted = (item: SlateItem, pod: SectorPod, forceProbe = false) => {
    if (selected.length >= maxTrades || selectedIds.has(item.opportunity.id)) return false;
    if (!canDeployFromPodBudget(item.opportunity, pod, deployments.get(pod.sector), forceProbe)) return false;
    selected.push(item);
    selectedIds.add(item.opportunity.id);
    const current = deployments.get(pod.sector) ?? { trades: 0, notional: 0 };
    deployments.set(pod.sector, {
      trades: current.trades + 1,
      notional: money(current.notional + opportunityNotional(item.opportunity))
    });
    return true;
  };

  const budgetedProbePods = state.pods
    .filter((pod) => pod.approvedCandidates > 0 && pod.mandate.availableBudget > 0)
    .filter((pod) => pod.lifecycleStatus !== "sleeping" && pod.lifecycleStatus !== "defense" && pod.lifecycleStatus !== "closed")
    .sort((a, b) => podProbePriority(b) - podProbePriority(a) || b.mandate.mandateScore - a.mandate.mandateScore);

  for (const pod of budgetedProbePods) {
    const probe = candidates.find((item) => classifyPodSector(item.opportunity.market) === pod.sector && !selectedIds.has(item.opportunity.id));
    if (probe) addIfBudgeted(probe, pod, pod.lifecycleStatus === "incubating" || pod.lifecycleStatus === "scouting");
    if (selected.length >= maxTrades) return selected;
  }

  for (const item of candidates) {
    const pod = podBySector.get(classifyPodSector(item.opportunity.market));
    if (!pod) continue;
    addIfBudgeted(item, pod);
    if (selected.length >= maxTrades) break;
  }

  return selected;
}

export async function runPaperCycle(options: { enqueueCoordinationTask?: boolean } = {}): Promise<PaperCycleResult> {
  return traceAsync("agent.paper_cycle", {}, async () => {
    const cycleId = `paper-cycle-${Date.now()}`;
    const enqueueCoordinationTask = options.enqueueCoordinationTask ?? true;
    const config = getPaperCycleConfig();
    const startingPortfolio = await getPortfolioSnapshot();
    const opportunities = await getOpportunities();
    const slate = selectPaperCycleSlate(
      opportunities,
      startingPortfolio,
      config.maxTradesPerCycle,
      config.minCycleScore
    );
    const eligibleIds = new Set(opportunities.filter(isPaperCycleEligible).map((opportunity) => opportunity.id));
    const slateIds = new Set(slate.map(({ opportunity }) => opportunity.id));
    const orders: TradeOrder[] = [];
    const blockedOpportunities: PaperCycleResult["blockedOpportunities"] = [];
    let executionBlocked = 0;
    let idempotentSkips = 0;

    if (enqueueCoordinationTask) {
      await enqueueTask("cio-paper-cycle", {
        cycleId,
        kind: "paper_cycle",
        maxTrades: String(config.maxTradesPerCycle),
        minScore: String(config.minCycleScore),
        createdAt: new Date().toISOString()
      });
    }

    await appendAuditEvent(
      auditEvent(
        "agent_decision",
        "CIO / Senior PM Agent",
        `Started ${cycleId}: evaluating ${opportunities.length} Kalshi-backed candidates and routing ${slate.length} to execution.`,
        "info",
        cycleId
      )
    );

    for (const opportunity of opportunities) {
      await saveOpportunity(opportunity);
    }

    for (const { opportunity, score } of slate) {
      await appendAuditEvent(
        auditEvent(
          "agent_decision",
          "CIO / Senior PM Agent",
          `Selected ${opportunity.market.ticker} ${opportunity.side.toUpperCase()} for paper execution with cycle score ${score.toFixed(1)}.`,
          "info",
          `${cycleId}-${opportunity.id}`
        )
      );
      const result = await approvePaperTrade(opportunity, "agent");
      if (result.blocked || !result.order || result.order.status === "blocked") {
        executionBlocked += 1;
        blockedOpportunities.push({
          id: opportunity.id,
          ticker: opportunity.market.ticker,
          reasons: result.order?.rejectionReason ? [result.order.rejectionReason] : ["Pre-trade review blocked execution."]
        });
        continue;
      }
      if (result.replayed) {
        idempotentSkips += 1;
        blockedOpportunities.push({
          id: opportunity.id,
          ticker: opportunity.market.ticker,
          reasons: ["Skipped because the agent already paper-filled this opportunity today."]
        });
        continue;
      }
      orders.push(result.order);
    }

    const nonSlateBlocked = opportunities
      .filter((opportunity) => !slateIds.has(opportunity.id))
      .map((opportunity) => ({
        id: opportunity.id,
        ticker: opportunity.market.ticker,
        reasons: nonSlateReasons(opportunity, startingPortfolio)
      }));
    blockedOpportunities.push(...nonSlateBlocked);

    const portfolio = await getPortfolioSnapshot();
    await appendAuditEvent(
      auditEvent(
        "paper_order",
        "Execution Supervisor Agent",
        `${cycleId} complete: ${orders.length} paper orders filled, ${blockedOpportunities.length} candidates blocked or skipped.`,
        orders.length ? "success" : "warning",
        `${cycleId}-complete`
      )
    );

    return {
      cycleId,
      evaluated: opportunities.length,
      eligible: eligibleIds.size,
      executed: orders.length,
      blocked: opportunities.filter((opportunity) => !eligibleIds.has(opportunity.id)).length + executionBlocked,
      skipped: opportunities.filter((opportunity) => eligibleIds.has(opportunity.id) && !slateIds.has(opportunity.id)).length + idempotentSkips,
      orders,
      blockedOpportunities,
      portfolio,
      createdAt: new Date().toISOString()
    };
  });
}

function agentPaperTradesToday(portfolio: PortfolioSnapshot): Set<string> {
  const today = new Date().toISOString().slice(0, 10);
  return new Set(
    portfolio.orders
      .filter((order) => order.source === "agent" && order.status === "paper_filled")
      .filter((order) => order.createdAt.slice(0, 10) === today)
      .map((order) => order.opportunityId)
  );
}

function canDeployFromPodBudget(
  opportunity: Opportunity,
  pod: SectorPod,
  deployment: { trades: number; notional: number } | undefined,
  forceProbe: boolean
): boolean {
  if (pod.lifecycleStatus === "sleeping" || pod.lifecycleStatus === "defense" || pod.lifecycleStatus === "closed") return false;
  const budget = getFundGovernancePolicy().capitalBudgeting;
  const current = deployment ?? { trades: 0, notional: 0 };
  const maxTrades = Math.max(1, Math.floor(budget.maxTradesPerPodPerCycle));
  if (current.trades >= maxTrades) return false;
  const notional = opportunityNotional(opportunity);
  const remainingPodBudget = Math.max(0, pod.mandate.availableBudget - current.notional);
  const cycleBudget = Math.max(
    forceProbe ? budget.minIncubatingProbeBudget : 0,
    pod.mandate.capitalBudget * budget.maxCycleDeploymentFraction
  );
  const remainingCycleBudget = Math.max(0, cycleBudget - current.notional);
  return notional <= Math.min(remainingPodBudget, remainingCycleBudget) + 0.01;
}

function opportunityNotional(opportunity: Opportunity): number {
  return money(Math.max(0, opportunity.risk.positionSize));
}

function uniqueMarkets(markets: Market[]): Market[] {
  return [...new Map(markets.map((market) => [market.ticker, market])).values()];
}

function podProbePriority(pod: SectorPod): number {
  if (pod.lifecycleStatus === "incubating" || pod.lifecycleStatus === "scouting") return 4;
  if (pod.lifecycleStatus === "active") return 3;
  if (pod.lifecycleStatus === "pip") return 1;
  return 0;
}

function nonSlateReasons(opportunity: Opportunity, portfolio: PortfolioSnapshot): string[] {
  const alreadyTraded = agentPaperTradesToday(portfolio).has(opportunity.id);
  const alreadyPositioned = portfolio.positions.some((position) => position.ticker === opportunity.market.ticker);
  if (alreadyTraded) return ["Skipped because the agent already paper-filled this opportunity today."];
  if (alreadyPositioned) return ["Skipped because the portfolio already has paper exposure in this ticker."];
  if (opportunity.risk.approved && opportunity.compliance.approved) {
    return [`Skipped by CIO cycle score ${paperCycleScore(opportunity, portfolio).toFixed(1)}.`];
  }
  return [...opportunity.risk.reasons, ...opportunity.compliance.blockedReasons];
}

function auditEvent(
  type: ActivityEvent["type"],
  actor: string,
  message: string,
  severity: ActivityEvent["severity"],
  id: string
): ActivityEvent {
  return {
    id,
    type,
    actor,
    message,
    severity,
    createdAt: new Date().toISOString()
  };
}

function money(value: number) {
  return Number(value.toFixed(2));
}
