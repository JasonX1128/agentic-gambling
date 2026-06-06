import type { ActivityEvent, Opportunity, PortfolioSnapshot, TradeOrder, TradingMode } from "@/lib/domain";
import { getEnv, getRiskLimits, livePrerequisites, boolEnv } from "@/lib/config/env";
import { applyPaperFill, getPortfolioSnapshot } from "@/lib/portfolio/engine";
import { appendAuditEvent, requireRedisForTrading, withIdempotency } from "@/lib/redis/coordination";
import { KalshiClient } from "@/lib/kalshi/client";
import { evaluateRisk } from "@/lib/risk/engine";
import { evaluateCompliance } from "@/lib/compliance/engine";
import { traceAsync } from "@/lib/observability/weave";

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
    const draftOrder = buildTradeOrder(opportunity, "paper", source, auditId);
    const risk = evaluateRisk(
      {
        market: opportunity.market,
        forecast: opportunity.forecast,
        requestedNotional: orderNotional(draftOrder),
        portfolio
      },
      getRiskLimits()
    );
    const compliance = evaluateCompliance({
      market: opportunity.market,
      thesis: opportunity.thesis,
      forecast: opportunity.forecast
    });
    const order = risk.approved
      ? buildTradeOrder({ ...opportunity, risk }, "paper", source, auditId)
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
      const portfolio = await applyPaperFill(order, markPriceForSide(opportunity));
      await appendAuditEvent(
        auditEvent(
          "paper_order",
          "Execution Supervisor Agent",
          `Paper-filled ${order.quantity} ${order.side.toUpperCase()} contracts in ${order.ticker}.`,
          "success",
          auditId
        )
      );
      return { order: { ...order, status: "paper_filled" as const }, portfolio, blocked: false };
    });
    return { ...result.value, replayed: result.replayed };
  });
}

export async function executeLiveTrade(opportunity: Opportunity, approvalToken?: string) {
  return traceAsync("execution.live_order", { opportunityId: opportunity.id, approvalTokenPresent: Boolean(approvalToken) }, async () => {
    const env = getEnv();
    const live = livePrerequisites(env);
    if (!live.ok) {
      return {
        blocked: true,
        code: "LIVE_TRADING_DISABLED",
        reasons: live.missing
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
    const portfolio = await getPortfolioSnapshot();
    const draftOrder = buildTradeOrder(opportunity, "live", "operator", `audit-${Date.now()}`);
    const risk = evaluateRisk(
      {
        market: opportunity.market,
        forecast: opportunity.forecast,
        requestedNotional: orderNotional(draftOrder),
        portfolio
      },
      getRiskLimits()
    );
    const compliance = evaluateCompliance({
      market: opportunity.market,
      thesis: opportunity.thesis,
      forecast: opportunity.forecast
    });
    if (!risk.approved || !compliance.approved) {
      return {
        blocked: true,
        code: "PRE_TRADE_REVIEW_BLOCKED",
        reasons: [...risk.reasons, ...compliance.blockedReasons]
      };
    }
    const client = new KalshiClient();
    const order = buildTradeOrder({ ...opportunity, risk }, "live", "operator", draftOrder.auditId);
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
    return { blocked: false, order: { ...order, status: "live_submitted" as const }, kalshi: response.value };
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
    createdAt: new Date().toISOString()
  };
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
