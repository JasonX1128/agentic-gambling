import type { ActivityEvent, Opportunity, TradeOrder, TradingMode } from "@/lib/domain";
import { getEnv, getRiskLimits, livePrerequisites, boolEnv } from "@/lib/config/env";
import { applyPaperFill } from "@/lib/portfolio/engine";
import { appendAuditEvent, requireRedisForTrading, withIdempotency } from "@/lib/redis/coordination";
import { KalshiClient } from "@/lib/kalshi/client";
import { evaluateRisk } from "@/lib/risk/engine";
import { evaluateCompliance } from "@/lib/compliance/engine";
import { traceAsync } from "@/lib/observability/weave";

export async function approvePaperTrade(opportunity: Opportunity, source: TradeOrder["source"] = "operator") {
  return traceAsync("execution.paper_order", { opportunityId: opportunity.id, ticker: opportunity.market.ticker }, async () => {
    await requireRedisForTrading();
    const auditId = `audit-${Date.now()}`;
    const order: TradeOrder = {
      id: `paper-${opportunity.market.ticker}-${Date.now()}`,
      opportunityId: opportunity.id,
      ticker: opportunity.market.ticker,
      mode: "paper",
      action: "buy",
      side: opportunity.side,
      quantity: Math.max(1, Math.floor(opportunity.risk.positionSize / Math.max(1, opportunity.market.yesAsk))),
      limitPrice: opportunity.side === "yes" ? opportunity.market.yesAsk : opportunity.market.noAsk,
      status: "proposed",
      source,
      auditId,
      traceId: opportunity.traceId,
      createdAt: new Date().toISOString()
    };
    const risk = evaluateRisk(
      {
        market: opportunity.market,
        forecast: opportunity.forecast,
        requestedNotional: order.quantity * (order.limitPrice / 100)
      },
      getRiskLimits()
    );
    const compliance = evaluateCompliance({
      market: opportunity.market,
      thesis: opportunity.thesis,
      forecast: opportunity.forecast
    });
    if (!risk.approved || !compliance.approved) {
      const blocked: TradeOrder = {
        ...order,
        status: "blocked",
        rejectionReason: [...risk.reasons, ...compliance.blockedReasons].join(" ")
      };
      await appendAuditEvent(auditEvent("blocked", "Execution Supervisor Agent", blocked.rejectionReason ?? "Trade blocked.", "warning", auditId));
      return { order: blocked, portfolio: undefined, blocked: true };
    }
    const result = await withIdempotency(`paper:${opportunity.id}:${source}`, async () => {
      const portfolio = await applyPaperFill(order, opportunity.market.lastPrice || order.limitPrice);
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
    return result.value;
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
    const client = new KalshiClient();
    const order: TradeOrder = {
      id: `live-${opportunity.market.ticker}-${Date.now()}`,
      opportunityId: opportunity.id,
      ticker: opportunity.market.ticker,
      mode: "live",
      action: "buy",
      side: opportunity.side,
      quantity: Math.max(1, Math.floor(opportunity.risk.positionSize / Math.max(1, opportunity.market.yesAsk))),
      limitPrice: opportunity.side === "yes" ? opportunity.market.yesAsk : opportunity.market.noAsk,
      status: "proposed",
      source: "operator",
      auditId: `audit-${Date.now()}`,
      traceId: opportunity.traceId,
      createdAt: new Date().toISOString()
    };
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
