import type { DemoRun, Opportunity } from "@/lib/domain";
import { buildDemoOpportunities, buildSectorPods, demoActivity } from "@/lib/data/seeds";
import { getMarkets } from "@/lib/services/market-service";
import { getPortfolioSnapshot } from "@/lib/portfolio/engine";
import { staticIntegrationStatus } from "@/lib/config/env";
import { redisHealth } from "@/lib/redis/client";
import { traceAsync } from "@/lib/observability/weave";

export async function getOpportunities(): Promise<Opportunity[]> {
  const { markets } = await getMarkets();
  return buildDemoOpportunities(markets);
}

export async function runDemoWorkflow(): Promise<DemoRun> {
  return traceAsync("trade.lifecycle.demo_scan", {}, async () => {
    const marketResult = await getMarkets();
    const opportunities = buildDemoOpportunities(marketResult.markets);
    const redis = await redisHealth();
    const status = staticIntegrationStatus().map((item) => (item.name === "Redis" ? redis : item));
    return {
      mode: "paper",
      marketSource: marketResult.source,
      marketBlocker: marketResult.blocker,
      markets: marketResult.markets,
      opportunities,
      portfolio: await getPortfolioSnapshot(),
      activity: demoActivity,
      pods: buildSectorPods(marketResult.markets),
      integrationStatus: status
    };
  });
}

export function explainOpportunity(opportunity: Opportunity): string {
  return [
    `${opportunity.market.ticker}: ${opportunity.thesis.summary}`,
    `Market probability ${(opportunity.forecast.marketProbability * 100).toFixed(1)}%, fair probability ${(opportunity.forecast.fairProbability * 100).toFixed(1)}%.`,
    `EV ${(opportunity.forecast.expectedValue * 100).toFixed(1)} points, confidence ${(opportunity.forecast.confidence * 100).toFixed(0)}%, liquidity ${(opportunity.forecast.liquidityQuality * 100).toFixed(0)}%.`,
    `Risk: ${opportunity.risk.reasons.join(" ")}`,
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
      `Risk/Compliance: ${opportunity.risk.approved ? "risk pass" : "risk blocked"}; ${opportunity.compliance.approved ? "compliance pass" : "compliance blocked"}.`,
      ""
    ])
  ].join("\n");
}
