import type { ActivityEvent, Opportunity, PaperCycleResult, PortfolioSnapshot, TradeOrder } from "@/lib/domain";
import { getPaperCycleConfig } from "@/lib/config/env";
import { getOpportunities } from "@/lib/agents/orchestrator";
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
  return opportunities
    .filter(isPaperCycleEligible)
    .filter((opportunity) => !alreadyTraded.has(opportunity.id))
    .filter((opportunity) => !positionedTickers.has(opportunity.market.ticker))
    .map((opportunity) => ({
      opportunity,
      score: paperCycleScore(opportunity, portfolio)
    }))
    .filter((item) => item.score >= minCycleScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTrades);
}

export async function runPaperCycle(): Promise<PaperCycleResult> {
  return traceAsync("agent.paper_cycle", {}, async () => {
    const cycleId = `paper-cycle-${Date.now()}`;
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

    await enqueueTask("cio-paper-cycle", {
      cycleId,
      kind: "paper_cycle",
      maxTrades: String(config.maxTradesPerCycle),
      minScore: String(config.minCycleScore),
      createdAt: new Date().toISOString()
    });

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
