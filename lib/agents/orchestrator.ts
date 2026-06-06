import type { DemoRun, Opportunity } from "@/lib/domain";
import { agentHierarchy, buildDemoOpportunities, buildSectorPods, demoActivity } from "@/lib/data/seeds";
import { getMarkets } from "@/lib/services/market-service";
import { getPortfolioSnapshot } from "@/lib/portfolio/engine";
import { staticIntegrationStatus } from "@/lib/config/env";
import { redisHealth } from "@/lib/redis/client";
import { traceAsync } from "@/lib/observability/weave";

export async function getOpportunities(): Promise<Opportunity[]> {
  const { markets } = await getMarkets();
  const portfolio = await getPortfolioSnapshot();
  return buildDemoOpportunities(markets, portfolio);
}

export async function runDemoWorkflow(): Promise<DemoRun> {
  return traceAsync("trade.lifecycle.demo_scan", {}, async () => {
    const marketResult = await getMarkets();
    const portfolio = await getPortfolioSnapshot();
    const opportunities = buildDemoOpportunities(marketResult.markets, portfolio);
    const redis = await redisHealth();
    const status = staticIntegrationStatus().map((item) => (item.name === "Redis" ? redis : item));
    return {
      mode: "paper",
      marketSource: marketResult.source,
      marketBlocker: marketResult.blocker,
      markets: marketResult.markets,
      opportunities,
      portfolio,
      activity: demoActivity,
      fundAgents: agentHierarchy,
      pods: buildSectorPods(marketResult.markets, opportunities),
      integrationStatus: status
    };
  });
}

export function explainOpportunity(opportunity: Opportunity): string {
  const directionalEdge = Math.abs(opportunity.forecast.expectedValue);
  return [
    `${opportunity.market.ticker}: ${opportunity.thesis.summary}`,
    `Market probability ${(opportunity.forecast.marketProbability * 100).toFixed(1)}%, fair probability ${(opportunity.forecast.fairProbability * 100).toFixed(1)}%.`,
    `${opportunity.side.toUpperCase()} edge ${(directionalEdge * 100).toFixed(1)} points, confidence ${(opportunity.forecast.confidence * 100).toFixed(0)}%, liquidity ${(opportunity.forecast.liquidityQuality * 100).toFixed(0)}%.`,
    `Risk: ${opportunity.risk.reasons.join(" ")}`,
    opportunity.risk.counterOffer.accepted
      ? `Risk counteroffer accepted: $${opportunity.risk.counterOffer.positionSize} max notional, entry <= ${opportunity.risk.counterOffer.maxEntryPrice} cents.`
      : `Risk counteroffer pending: ${opportunity.risk.counterOffer.conditions.join(" ")}`,
    opportunity.compliance.approved
      ? "Compliance: public evidence and settlement source checks pass; human approval remains required."
      : `Compliance blocked: ${opportunity.compliance.blockedReasons.join(" ")}`
  ].join("\n");
}

export async function generateCioMemo(opportunityIds?: string[]): Promise<string> {
  const opportunities = await getOpportunities();
  const selected = opportunityIds?.length
    ? opportunities.filter((opportunity) => opportunityIds.includes(opportunity.id))
    : opportunities.slice(0, 3);
  return [
    "# CIO Memo",
    "",
    "Mode: paper by default. No live execution is authorized unless all live prerequisites and risk controls pass.",
    "",
    ...selected.flatMap((opportunity, index) => [
      `## ${index + 1}. ${opportunity.market.title}`,
      `Ticker: ${opportunity.market.ticker}`,
      `Recommendation: ${opportunity.side.toUpperCase()} with capped paper notional ${opportunity.risk.positionSize}.`,
      `Forecast: fair ${(opportunity.forecast.fairProbability * 100).toFixed(1)}% vs market ${(opportunity.forecast.marketProbability * 100).toFixed(1)}%.`,
      `Why attractive: ${opportunity.thesis.summary}`,
      `What breaks it: ${opportunity.thesis.invalidation.join(" ")}`,
      `Risk negotiation: ${opportunity.risk.counterOffer.accepted ? "accepted" : "pending"}; ${opportunity.risk.counterOffer.conditions.join(" ")}`,
      `Risk/Compliance: ${opportunity.risk.approved ? "risk pass" : "risk blocked"}; ${opportunity.compliance.approved ? "compliance pass" : "compliance blocked"}.`,
      ""
    ])
  ].join("\n");
}
