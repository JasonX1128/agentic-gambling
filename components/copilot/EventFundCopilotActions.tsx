"use client";

import { useAgentContext, useFrontendTool } from "@copilotkit/react-core/v2/headless";
import type { JsonSerializable } from "@copilotkit/react-core/v2/headless";
import { z } from "zod";
import type { DemoRun } from "@/lib/domain";

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
        side: opportunity.side,
        expectedValue: opportunity.forecast.expectedValue,
        confidence: opportunity.forecast.confidence,
        riskApproved: opportunity.risk.approved,
        complianceApproved: opportunity.compliance.approved,
        status: opportunity.status
      })),
      integrations: data.integrationStatus,
      pods: data.pods
    } as unknown as JsonSerializable;

  useAgentContext({
    description:
      "EventFund OS compressed operating state: portfolio, opportunities, integration status, trading mode, risk/compliance status, and visible sector pods.",
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
    description: "Approve a paper trade. This never sends an order to Kalshi and is still risk/compliance checked.",
    parameters: z.object({ opportunityId: z.string() }),
    handler: async ({ opportunityId }, { signal }) =>
      apiJson(`/api/trades/${encodeURIComponent(opportunityId)}/approve`, {
        method: "POST",
        body: JSON.stringify({ source: "copilot" })
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
