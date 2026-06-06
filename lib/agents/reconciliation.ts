import type { ActivityEvent, Market, SettlementOutcome } from "@/lib/domain";
import { getPortfolioSnapshot } from "@/lib/portfolio/engine";
import { settlePaperTrade } from "@/lib/execution/engine";
import { appendAuditEvent, enqueueTask } from "@/lib/redis/coordination";
import { KalshiClient } from "@/lib/kalshi/client";
import { inferSettledOutcome } from "@/lib/agents/settlement-rules";
import { traceAsync } from "@/lib/observability/weave";

export type ReconciliationResult = {
  checked: number;
  settled: number;
  unresolved: Array<{ ticker: string; reason: string }>;
  settlements: Array<{ ticker: string; outcome: SettlementOutcome; realizedPnl: number }>;
  createdAt: string;
};

export async function reconcilePaperSettlements(input: { markets?: Market[]; enqueue?: boolean } = {}): Promise<ReconciliationResult> {
  return traceAsync("agent.paper_reconciliation", {}, async () => {
    const portfolio = await getPortfolioSnapshot();
    const client = new KalshiClient();
    const marketByTicker = new Map((input.markets ?? []).map((market) => [market.ticker, market]));
    const unresolved: ReconciliationResult["unresolved"] = [];
    const settlements: ReconciliationResult["settlements"] = [];

    if (input.enqueue ?? true) {
      await enqueueTask("postmortem", {
        kind: "settlement_reconciliation",
        positions: String(portfolio.positions.length),
        createdAt: new Date().toISOString()
      });
    }

    for (const position of portfolio.positions) {
      let market = marketByTicker.get(position.ticker);
      try {
        market = market ?? (await client.getMarket(position.ticker));
      } catch (error) {
        unresolved.push({
          ticker: position.ticker,
          reason: `Kalshi detail lookup failed: ${error instanceof Error ? error.message : String(error)}`
        });
        continue;
      }

      const outcome = inferSettledOutcome(market);
      if (!outcome) {
        unresolved.push({
          ticker: position.ticker,
          reason:
            market.status === "settled"
              ? "Kalshi marks the market settled, but the resolved side was not inferable from quoted prices."
              : `Kalshi status is ${market.status}; settlement is not ready.`
        });
        continue;
      }

      try {
        const result = await settlePaperTrade({
          ticker: position.ticker,
          outcome,
          source: "agent",
          notes: "Auto-reconciled from Kalshi settled market status."
        });
        settlements.push({
          ticker: position.ticker,
          outcome,
          realizedPnl: result.settlement.realizedPnl
        });
      } catch (error) {
        unresolved.push({
          ticker: position.ticker,
          reason: `Paper settlement failed: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }

    await appendAuditEvent(
      auditEvent(
        "postmortem",
        "Settlement Reconciliation Worker",
        `Checked ${portfolio.positions.length} open paper positions; auto-settled ${settlements.length}.`,
        settlements.length ? "success" : "info",
        { unresolved: unresolved.slice(0, 10), settlements }
      )
    );

    return {
      checked: portfolio.positions.length,
      settled: settlements.length,
      unresolved,
      settlements,
      createdAt: new Date().toISOString()
    };
  });
}

function auditEvent(
  type: ActivityEvent["type"],
  actor: string,
  message: string,
  severity: ActivityEvent["severity"],
  payload?: Record<string, unknown>
): ActivityEvent {
  return {
    id: `audit-reconcile-${Date.now()}`,
    type,
    actor,
    message,
    severity,
    createdAt: new Date().toISOString(),
    payload
  };
}
