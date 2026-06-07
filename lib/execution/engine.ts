import type {
  ActivityEvent,
  LiveOrderPreview,
  Opportunity,
  PortfolioSnapshot,
  SettlementOutcome,
  TradeOrder,
  TradeWatchTask,
  TradingMode
} from "@/lib/domain";
import { getEnv, getRiskLimits, livePrerequisites, boolEnv } from "@/lib/config/env";
import { applyPaperClose, applyPaperFill, applyPaperSettlement, getPortfolioSnapshot } from "@/lib/portfolio/engine";
import {
  appendAuditEvent,
  appendOperatorAuditLog,
  enqueueTask,
  requireRedisForTrading,
  saveTradeWatchTask,
  withIdempotency
} from "@/lib/redis/coordination";
import { KalshiClient } from "@/lib/kalshi/client";
import { evaluateRisk } from "@/lib/risk/engine";
import { evaluateCompliance } from "@/lib/compliance/engine";
import { traceAsync } from "@/lib/observability/weave";
import { calibrationBucket } from "@/lib/quant/scoring";
import { researchOpportunityWithBrowserAgent } from "@/lib/research/browser-agent";

export type PaperTradeResult = {
  order: TradeOrder;
  portfolio?: PortfolioSnapshot;
  blocked: boolean;
  replayed: boolean;
};

export async function approvePaperTrade(
  opportunity: Opportunity,
  source: TradeOrder["source"] = "operator"
): Promise<PaperTradeResult> {
  return traceAsync("execution.paper_order", { opportunityId: opportunity.id, ticker: opportunity.market.ticker }, async () => {
    await requireRedisForTrading();
    const auditId = `audit-${Date.now()}`;
    const portfolio = await getPortfolioSnapshot();
    const researchedOpportunity = await researchOpportunityWithBrowserAgent(opportunity);
    const draftOrder = buildTradeOrder(researchedOpportunity, "paper", source, auditId);
    const risk = evaluateRisk(
      {
        market: researchedOpportunity.market,
        forecast: researchedOpportunity.forecast,
        requestedNotional: orderNotional(draftOrder),
        portfolio
      },
      getRiskLimits()
    );
    const compliance = evaluateCompliance({
      market: researchedOpportunity.market,
      thesis: researchedOpportunity.thesis,
      forecast: researchedOpportunity.forecast
    });
    const order = risk.approved
      ? buildTradeOrder({ ...researchedOpportunity, risk, compliance }, "paper", source, auditId)
      : draftOrder;
    if (!risk.approved || !compliance.approved) {
      const blocked: TradeOrder = {
        ...order,
        status: "blocked",
        rejectionReason: [...risk.reasons, ...compliance.blockedReasons].join(" ")
      };
      await appendAuditEvent(auditEvent("blocked", "Execution Supervisor Agent", blocked.rejectionReason ?? "Trade blocked.", "warning", auditId));
      return { order: blocked, portfolio: undefined, blocked: true, replayed: false };
    }
    const result = await withIdempotency(`paper:${opportunity.id}:${source}:${new Date().toISOString().slice(0, 10)}`, async () => {
      const portfolio = await applyPaperFill(order, markPriceForSide(researchedOpportunity));
      await appendAuditEvent(
        auditEvent(
          "paper_order",
          "Execution Supervisor Agent",
          `Paper-filled ${order.quantity} ${order.side.toUpperCase()} contracts in ${order.ticker}.`,
          "success",
          auditId
        )
      );
      const watchTasks = buildTradeWatchTasks(order, researchedOpportunity);
      await Promise.all(watchTasks.map((task) => saveTradeWatchTask(task)));
      await Promise.all(watchTasks.map((task) =>
        enqueueTask("trade-monitor", {
          kind: "trade_watch",
          taskId: task.id,
          ticker: task.ticker,
          sector: task.sector,
          createdAt: task.createdAt
        })
      ));
      return { order: { ...order, status: "paper_filled" as const }, portfolio, blocked: false };
    });
    return { ...result.value, replayed: result.replayed };
  });
}

export async function previewLiveTrade(opportunity: Opportunity): Promise<LiveOrderPreview> {
  return traceAsync("execution.live_preview", { opportunityId: opportunity.id, ticker: opportunity.market.ticker }, async () => {
    await requireRedisForTrading();
    const env = getEnv();
    const live = livePrerequisites(env);
    const researchedOpportunity = await researchOpportunityWithBrowserAgent(opportunity);
    const portfolio = await getPortfolioSnapshot();
    const draftOrder = buildTradeOrder(researchedOpportunity, "live", "operator", `audit-preview-${Date.now()}`);
    const risk = evaluateRisk(
      {
        market: researchedOpportunity.market,
        forecast: researchedOpportunity.forecast,
        requestedNotional: orderNotional(draftOrder),
        portfolio
      },
      getRiskLimits()
    );
    const compliance = evaluateCompliance({
      market: researchedOpportunity.market,
      thesis: researchedOpportunity.thesis,
      forecast: researchedOpportunity.forecast
    });
    const reasons = [
      ...live.missing,
      ...(!risk.approved ? risk.reasons : []),
      ...(!compliance.approved ? compliance.blockedReasons : [])
    ];
    const preview: LiveOrderPreview = {
      id: `live-preview-${opportunity.id}-${Date.now()}`,
      opportunityId: opportunity.id,
      ticker: opportunity.market.ticker,
      dryRun: true,
      blocked: reasons.length > 0,
      reasons,
      order: risk.approved && compliance.approved ? buildTradeOrder({ ...researchedOpportunity, risk, compliance }, "live", "operator", draftOrder.auditId) : draftOrder,
      risk,
      compliance,
      livePrerequisites: live.missing,
      operatorApprovalRequired: true,
      createdAt: new Date().toISOString()
    };
    await appendOperatorAuditLog({
      type: "live_order_preview",
      opportunityId: opportunity.id,
      ticker: opportunity.market.ticker,
      blocked: preview.blocked,
      reasons: preview.reasons
    });
    await appendAuditEvent(
      auditEvent(
        "live_gate",
        "Execution Supervisor Agent",
        `Dry-run live preview ${preview.blocked ? "blocked" : "ready"} for ${preview.ticker}.`,
        preview.blocked ? "warning" : "info",
        preview.id,
        { preview }
      )
    );
    return preview;
  });
}

export async function executeLiveTrade(opportunity: Opportunity, approvalToken?: string) {
  return traceAsync("execution.live_order", { opportunityId: opportunity.id, approvalTokenPresent: Boolean(approvalToken) }, async () => {
    const env = getEnv();
    const preview = await previewLiveTrade(opportunity);
    if (preview.blocked) {
      return {
        blocked: true,
        code: "LIVE_PREVIEW_BLOCKED",
        reasons: preview.reasons,
        preview
      };
    }
    if (!approvalToken || approvalToken !== `approve:${opportunity.id}`) {
      return {
        blocked: true,
        code: "LIVE_GATE_REQUIRED",
        reasons: ["Explicit approval token is required before any live order."]
      };
    }
    const mode: TradingMode = env.TRADING_MODE;
    if (mode !== "live" || !boolEnv(env.ENABLE_LIVE_TRADING)) {
      return { blocked: true, code: "LIVE_MODE_NOT_ACTIVE", reasons: ["Server trading mode is not live."] };
    }
    await requireRedisForTrading();
    const researchedOpportunity = await researchOpportunityWithBrowserAgent(opportunity);
    const portfolio = await getPortfolioSnapshot();
    const draftOrder = buildTradeOrder(researchedOpportunity, "live", "operator", `audit-${Date.now()}`);
    const risk = evaluateRisk(
      {
        market: researchedOpportunity.market,
        forecast: researchedOpportunity.forecast,
        requestedNotional: orderNotional(draftOrder),
        portfolio
      },
      getRiskLimits()
    );
    const compliance = evaluateCompliance({
      market: researchedOpportunity.market,
      thesis: researchedOpportunity.thesis,
      forecast: researchedOpportunity.forecast
    });
    if (!risk.approved || !compliance.approved) {
      return {
        blocked: true,
        code: "PRE_TRADE_REVIEW_BLOCKED",
        reasons: [...risk.reasons, ...compliance.blockedReasons]
      };
    }
    const client = new KalshiClient();
    const order = buildTradeOrder({ ...researchedOpportunity, risk, compliance }, "live", "operator", draftOrder.auditId);
    const response = await withIdempotency(`live:${opportunity.id}:${approvalToken}`, () =>
      client.createOrder({
        ticker: order.ticker,
        action: order.action,
        side: order.side,
        count: order.quantity,
        type: "limit",
        client_order_id: order.id,
        yes_price: order.side === "yes" ? order.limitPrice : undefined,
        no_price: order.side === "no" ? order.limitPrice : undefined
      })
    );
    await appendAuditEvent(
      auditEvent("live_gate", "Execution Supervisor Agent", `Submitted gated live order ${order.id} to Kalshi.`, "success", order.auditId)
    );
    await appendOperatorAuditLog({
      type: "live_order_submitted",
      opportunityId: opportunity.id,
      ticker: order.ticker,
      orderId: order.id,
      approvalToken: "[redacted]"
    });
    return { blocked: false, order: { ...order, status: "live_submitted" as const }, kalshi: response.value };
  });
}

export async function closePaperTrade(input: {
  ticker: string;
  exitPrice?: number;
  quantity?: number;
  source?: TradeOrder["source"];
  reason?: string;
}) {
  return traceAsync("execution.paper_close", { ticker: input.ticker }, async () => {
    await requireRedisForTrading();
    const portfolio = await getPortfolioSnapshot();
    const position = portfolio.positions.find((item) => item.ticker === input.ticker);
    if (!position) {
      return {
        blocked: true,
        code: "POSITION_NOT_FOUND",
        reasons: [`No open paper position found for ${input.ticker}.`]
      };
    }
    const exitPrice = input.exitPrice ?? Math.round(position.markPrice * 100);
    const result = await applyPaperClose({
      ticker: input.ticker,
      exitPrice,
      quantity: input.quantity,
      source: input.source ?? "operator",
      reason: input.reason,
      auditId: `audit-${Date.now()}`
    });
    await appendAuditEvent(
      auditEvent(
        "paper_order",
        "Execution Supervisor Agent",
        `Paper-closed ${result.order.quantity} ${result.order.side.toUpperCase()} contracts in ${input.ticker} for realized PnL $${result.realizedPnl}.`,
        result.realizedPnl >= 0 ? "success" : "warning",
        result.order.auditId,
        { ticker: input.ticker, realizedPnl: result.realizedPnl, reason: input.reason ?? "operator_close" }
      )
    );
    return { blocked: false, ...result };
  });
}

export async function settlePaperTrade(input: {
  ticker: string;
  outcome: SettlementOutcome;
  source?: TradeOrder["source"];
  notes?: string;
}) {
  return traceAsync("execution.paper_settlement", { ticker: input.ticker, outcome: input.outcome }, async () => {
    await requireRedisForTrading();
    const result = await applyPaperSettlement({
      ticker: input.ticker,
      outcome: input.outcome,
      source: input.source ?? "operator",
      notes: input.notes,
      auditId: `audit-${Date.now()}`
    });
    await appendAuditEvent(
      auditEvent(
        "postmortem",
        "Calibration Agent",
        `Settled ${input.ticker} as ${input.outcome.toUpperCase()}; realized PnL $${result.settlement.realizedPnl}, Brier ${
          result.settlement.brierScore?.toFixed(4) ?? "n/a"
        }.`,
        result.settlement.realizedPnl >= 0 ? "success" : "warning",
        result.order.auditId,
        {
          ticker: input.ticker,
          outcome: input.outcome,
          realizedPnl: result.settlement.realizedPnl,
          brierScore: result.settlement.brierScore,
          calibrationBucket: result.settlement.calibrationBucket
        }
      )
    );
    return { blocked: false, ...result };
  });
}

export function entryPriceForSide(opportunity: Opportunity): number {
  return opportunity.side === "yes" ? opportunity.market.yesAsk : opportunity.market.noAsk;
}

export function markPriceForSide(opportunity: Opportunity): number {
  if (opportunity.market.lastPrice > 0) {
    return opportunity.side === "yes" ? opportunity.market.lastPrice : Math.max(0, 100 - opportunity.market.lastPrice);
  }
  return entryPriceForSide(opportunity);
}

export function quantityForBudget(budgetDollars: number, limitPriceCents: number): number {
  const priceDollars = Math.max(0.01, limitPriceCents / 100);
  return Math.max(1, Math.floor(budgetDollars / priceDollars));
}

export function orderNotional(order: TradeOrder): number {
  return Number(((order.limitPrice / 100) * order.quantity).toFixed(2));
}

export function buildTradeOrder(
  opportunity: Opportunity,
  mode: TradingMode,
  source: TradeOrder["source"],
  auditId = `audit-${Date.now()}`
): TradeOrder {
  const limitPrice = entryPriceForSide(opportunity);
  const sideForecastProbability =
    opportunity.side === "yes" ? opportunity.forecast.fairProbability : 1 - opportunity.forecast.fairProbability;
  const sideMarketProbability =
    opportunity.side === "yes" ? opportunity.forecast.marketProbability : 1 - opportunity.forecast.marketProbability;
  return {
    id: `${mode}-${opportunity.market.ticker}-${Date.now()}`,
    opportunityId: opportunity.id,
    ticker: opportunity.market.ticker,
    sector: opportunity.sector,
    mode,
    action: "buy",
    side: opportunity.side,
    quantity: quantityForBudget(opportunity.risk.positionSize, limitPrice),
    limitPrice,
    status: "proposed",
    source,
    auditId,
    traceId: opportunity.traceId,
    forecastProbability: Number(sideForecastProbability.toFixed(4)),
    marketProbability: Number(sideMarketProbability.toFixed(4)),
    expectedValue: Math.abs(opportunity.forecast.expectedValue),
    confidence: opportunity.forecast.confidence,
    calibrationBucket: calibrationBucket(sideForecastProbability),
    createdAt: new Date().toISOString()
  };
}

function buildTradeWatchTasks(order: TradeOrder, opportunity: Opportunity): TradeWatchTask[] {
  const dueAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const base = {
    orderId: order.id,
    opportunityId: opportunity.id,
    ticker: order.ticker,
    sector: order.sector,
    status: "open" as const,
    createdAt: new Date().toISOString(),
    dueAt
  };
  return [
    {
      ...base,
      id: `watch-${order.id}-invalidation`,
      assignedTo: "Research Director Agent",
      trigger: "Thesis invalidation review",
      invalidation: opportunity.thesis.invalidation,
      publicSignals: opportunity.thesis.bearCase.length ? opportunity.thesis.bearCase : ["Check public sources for facts that contradict the trade thesis."],
      closeRules: ["Close or reduce if the primary invalidation condition becomes public and credible."],
      notifyPodIds: [opportunity.podId]
    },
    {
      ...base,
      id: `watch-${order.id}-public-signal`,
      assignedTo: "Browser Research Agent",
      trigger: "Public signal changed",
      invalidation: opportunity.thesis.invalidation,
      publicSignals: [`Re-check settlement source and public context for ${opportunity.market.title}.`],
      closeRules: ["Escalate to CIO if public odds/news move against fair value by more than the original edge."],
      notifyPodIds: [opportunity.podId]
    },
    {
      ...base,
      id: `watch-${order.id}-early-close`,
      assignedTo: "Execution Supervisor Agent",
      trigger: "Early close or resize",
      invalidation: opportunity.thesis.invalidation,
      publicSignals: ["Monitor mark-to-market, liquidity, spread, and time-to-close."],
      closeRules: ["Close if expected value flips negative, liquidity vanishes, or risk counteroffer conditions are no longer met."],
      notifyPodIds: [opportunity.podId]
    }
  ];
}

function auditEvent(
  type: ActivityEvent["type"],
  actor: string,
  message: string,
  severity: ActivityEvent["severity"],
  id: string,
  payload?: Record<string, unknown>
): ActivityEvent {
  return {
    id,
    type,
    actor,
    message,
    severity,
    createdAt: new Date().toISOString(),
    payload
  };
}
