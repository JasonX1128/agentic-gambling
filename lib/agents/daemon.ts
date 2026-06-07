import type { ActivityEvent, Market } from "@/lib/domain";
import { getAgentAutomationConfig } from "@/lib/config/env";
import { getPortfolioSnapshot, markPortfolioToMarket } from "@/lib/portfolio/engine";
import { getMarkets } from "@/lib/services/market-service";
import { acquireLock, appendAuditEvent, enqueueTask, publishEvent, releaseLock } from "@/lib/redis/coordination";
import { ensureFundWorkerGroups, runFundWorkersOnce, type WorkerRunResult } from "@/lib/agents/workers";
import { traceAsync } from "@/lib/observability/weave";

export type PaperDaemonTickResult = {
  tickId: string;
  locked: boolean;
  marketSource?: "kalshi" | "demo";
  marketBlocker?: string;
  markets: number;
  markedPositions: number;
  workerRun?: WorkerRunResult;
  createdAt: string;
};

export type PaperDaemonRunResult = {
  ticks: PaperDaemonTickResult[];
  intervalMs: number;
  completedAt: string;
};

export async function runPaperTradingDaemonTick(): Promise<PaperDaemonTickResult> {
  return traceAsync("agent.paper_daemon_tick", {}, async () => {
    const tickId = `paper-daemon-${Date.now()}`;
    const owner = `${tickId}-${process.pid}`;
    const locked = await acquireLock("paper-daemon", owner, 180_000);
    if (!locked) {
      return {
        tickId,
        locked: false,
        markets: 0,
        markedPositions: 0,
        createdAt: new Date().toISOString()
      };
    }

    try {
      const marketResult = await getMarkets();
      const marked = await markPortfolioToMarket(marketResult.markets).catch(() => getPortfolioSnapshot());
      await ensureFundWorkerGroups();
      await enqueueDaemonTasks(tickId, marketResult.markets, marked.positions.length);
      const workerRun = await runFundWorkersOnce({
        countPerStream: getAgentAutomationConfig().paperDaemonWorkerBatchSize,
        consumerName: `daemon-${process.pid}`
      });

      const result: PaperDaemonTickResult = {
        tickId,
        locked: true,
        marketSource: marketResult.source,
        marketBlocker: marketResult.blocker,
        markets: marketResult.markets.length,
        markedPositions: marked.positions.length,
        workerRun,
        createdAt: new Date().toISOString()
      };

      await appendAuditEvent(
        auditEvent(
          "system",
          "Continuous Paper Trading Daemon",
          `${tickId} complete: ${marketResult.markets.length} markets scanned, ${marked.positions.length} positions marked, ${workerRun.processed} worker tasks processed.`,
          workerRun.failed ? "warning" : "success",
          result
        )
      );
      await publishEvent("daemon", { type: "paper_daemon.tick", result });
      return result;
    } finally {
      await releaseLock("paper-daemon", owner);
    }
  });
}

export async function runPaperTradingDaemon(input: {
  ticks?: number;
  intervalMs?: number;
} = {}): Promise<PaperDaemonRunResult> {
  const config = getAgentAutomationConfig();
  const ticks = Math.max(1, Math.floor(input.ticks ?? config.paperDaemonMaxTicks));
  const intervalMs = Math.max(10_000, Math.floor(input.intervalMs ?? config.paperDaemonIntervalMs));
  const results: PaperDaemonTickResult[] = [];
  for (let index = 0; index < ticks; index += 1) {
    results.push(await runPaperTradingDaemonTick());
    if (index < ticks - 1) await sleep(intervalMs);
  }
  return {
    ticks: results,
    intervalMs,
    completedAt: new Date().toISOString()
  };
}

async function enqueueDaemonTasks(tickId: string, markets: Market[], positions: number) {
  const createdAt = new Date().toISOString();
  await enqueueTask("research", {
    kind: "research_scout",
    tickId,
    markets: String(markets.length),
    createdAt
  });
  await enqueueTask("research", {
    kind: "cross_pod_checkin",
    tickId,
    markets: String(markets.length),
    createdAt
  });
  await enqueueTask("risk", {
    kind: "risk_cluster_review",
    tickId,
    markets: String(markets.length),
    positions: String(positions),
    createdAt
  });
  await enqueueTask("cio-paper-cycle", {
    kind: "paper_cycle",
    tickId,
    createdAt
  });
  await enqueueTask("postmortem", {
    kind: "settlement_reconciliation",
    tickId,
    positions: String(positions),
    createdAt
  });
  await enqueueTask("policy-learning", {
    kind: "policy_learning",
    tickId,
    createdAt
  });
  await enqueueTask("fund-memory", {
    kind: "fund_memory_snapshot",
    tickId,
    markets: String(markets.length),
    createdAt
  });
  await enqueueTask("executive-review", {
    kind: "executive_review",
    tickId,
    createdAt
  });
}

function auditEvent(
  type: ActivityEvent["type"],
  actor: string,
  message: string,
  severity: ActivityEvent["severity"],
  payload: Record<string, unknown>
): ActivityEvent {
  return {
    id: `audit-daemon-${Date.now()}`,
    type,
    actor,
    message,
    severity,
    createdAt: new Date().toISOString(),
    payload
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
