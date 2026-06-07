import type { ActivityEvent } from "@/lib/domain";
import { buildFundOperatingState } from "@/lib/agents/fund-management";
import { getOpportunities } from "@/lib/agents/orchestrator";
import { runExecutiveCommitteeReview } from "@/lib/agents/executive-committee";
import { runAgentLearningLoop } from "@/lib/agents/learning";
import { runPaperCycle } from "@/lib/agents/paper-cycle";
import { reconcilePaperSettlements } from "@/lib/agents/reconciliation";
import { getPortfolioSnapshot } from "@/lib/portfolio/engine";
import { getMarkets } from "@/lib/services/market-service";
import {
  ackTask,
  appendBudgetCommitteeRecord,
  appendAuditEvent,
  ensureTaskConsumerGroup,
  readTaskBatch,
  savePodMemoryRecord,
  type RedisStreamTask
} from "@/lib/redis/coordination";
import { traceAsync } from "@/lib/observability/weave";

export const FUND_WORKER_STREAMS = [
  "research",
  "risk",
  "cio-paper-cycle",
  "postmortem",
  "policy-learning",
  "fund-memory",
  "trade-monitor",
  "executive-review"
] as const;

export type FundWorkerStream = (typeof FUND_WORKER_STREAMS)[number];

export type WorkerTaskResult = {
  stream: string;
  id: string;
  kind: string;
  status: "processed" | "failed";
  detail: string;
};

export type WorkerRunResult = {
  consumer: string;
  processed: number;
  failed: number;
  tasks: WorkerTaskResult[];
  createdAt: string;
};

export async function ensureFundWorkerGroups(groupName = "eventfund-workers") {
  for (const streamName of FUND_WORKER_STREAMS) {
    await ensureTaskConsumerGroup(streamName, groupName, "$");
  }
}

export async function runFundWorkersOnce(input: {
  streams?: readonly FundWorkerStream[];
  groupName?: string;
  consumerName?: string;
  countPerStream?: number;
} = {}): Promise<WorkerRunResult> {
  return traceAsync("agent.redis_workers_once", {}, async () => {
    const groupName = input.groupName ?? "eventfund-workers";
    const consumerName = input.consumerName ?? `worker-${process.pid}`;
    const streams = input.streams ?? FUND_WORKER_STREAMS;
    const tasks: WorkerTaskResult[] = [];

    for (const streamName of streams) {
      const rows = await readTaskBatch({
        streamName,
        groupName,
        consumerName,
        count: workerBatchCount(streamName, input.countPerStream ?? 5),
        blockMs: 0
      });
      for (const row of rows) {
        const result = await handleWorkerTask(row);
        tasks.push(result);
        if (result.status === "processed") {
          await ackTask(streamName, groupName, row.id);
        }
      }
    }

    const failed = tasks.filter((task) => task.status === "failed").length;
    if (tasks.length) {
      await appendAuditEvent(
        auditEvent(
          "system",
          "Redis Stream Worker Supervisor",
          `Processed ${tasks.length - failed}/${tasks.length} Redis Stream tasks across ${streams.length} fund queues.`,
          failed ? "warning" : "success",
          { tasks: tasks.slice(0, 20) }
        )
      );
    }

    return {
      consumer: consumerName,
      processed: tasks.length - failed,
      failed,
      tasks,
      createdAt: new Date().toISOString()
    };
  });
}

function workerBatchCount(streamName: FundWorkerStream, countPerStream: number): number {
  if (streamName === "cio-paper-cycle") return Math.min(3, countPerStream);
  return countPerStream;
}

async function handleWorkerTask(task: RedisStreamTask): Promise<WorkerTaskResult> {
  const kind = task.message.kind ?? task.stream;
  try {
    if (kind === "paper_cycle") {
      const result = await runPaperCycle({ enqueueCoordinationTask: false });
      return processed(task, kind, `Executed paper cycle ${result.cycleId}: ${result.executed} fills.`);
    }
    if (kind === "settlement_reconciliation") {
      const result = await reconcilePaperSettlements({ enqueue: false });
      return processed(task, kind, `Reconciled ${result.checked} positions and settled ${result.settled}.`);
    }
    if (kind === "policy_learning") {
      const result = await runAgentLearningLoop({ enqueueTask: false });
      return processed(task, kind, `Policy learning ${result.status}: ${result.reason}`);
    }
    if (kind === "fund_memory_snapshot") {
      const marketResult = await getMarkets();
      const portfolio = await getPortfolioSnapshot();
      const opportunities = await getOpportunities();
      const state = buildFundOperatingState({ markets: marketResult.markets, opportunities, portfolio });
      await Promise.all(state.podMemory.slice(0, 40).map((record) => savePodMemoryRecord(record)));
      await Promise.all(state.budgetCommitteeRecords.slice(0, 12).map((record) => appendBudgetCommitteeRecord(record)));
      await appendAuditEvent(
        auditEvent(
          "agent_decision",
          "Fund Memory Archivist Agent",
          `Archived ${state.podMemory.length} memory records and ${state.budgetCommitteeRecords.length} budget decisions.`,
          "success",
          { memory: state.podMemory.slice(0, 8), budget: state.budgetCommitteeRecords.slice(0, 8), task: task.message }
        )
      );
      return processed(task, kind, `Archived ${state.podMemory.length} pod memories.`);
    }
    if (kind === "executive_review") {
      const result = await runExecutiveCommitteeReview({ enqueueTask: false });
      return processed(task, kind, `Executive committee produced ${result.decisions.length} decisions.`);
    }
    if (kind === "research_scout") {
      await appendAuditEvent(
        auditEvent(
          "agent_decision",
          "Research Scout Worker",
          `Reviewed sector-discovery task for ${task.message.markets ?? "unknown"} markets and ${task.message.proposals ?? "unknown"} proposals.`,
          "info",
          { task: task.message }
        )
      );
      return processed(task, kind, "Research scout task audited.");
    }
    if (kind === "cross_pod_checkin") {
      const marketResult = await getMarkets();
      const portfolio = await getPortfolioSnapshot();
      const opportunities = await getOpportunities();
      const state = buildFundOperatingState({ markets: marketResult.markets, opportunities, portfolio });
      await appendAuditEvent(
        auditEvent(
          "agent_decision",
          "Cross-Pod Collaboration Chair",
          `Ran analyst check-ins: ${state.crossPodBriefings.length} briefings and ${state.crossPodConflicts.length} arbitrations across ${state.pods.length} pods.`,
          state.crossPodConflicts.length ? "warning" : state.crossPodBriefings.length ? "info" : "warning",
          { briefings: state.crossPodBriefings.slice(0, 8), conflicts: state.crossPodConflicts.slice(0, 8), task: task.message }
        )
      );
      return processed(task, kind, `Shared ${state.crossPodBriefings.length} briefings and ${state.crossPodConflicts.length} arbitrations.`);
    }
    if (kind === "risk_cluster_review") {
      await appendAuditEvent(
        auditEvent(
          "risk_check",
          "Cluster Risk Worker",
          `Reviewed event-cluster exposure task with ${task.message.positions ?? "unknown"} open positions.`,
          "info",
          { task: task.message }
        )
      );
      return processed(task, kind, "Cluster risk task audited.");
    }
    if (kind === "trade_watch") {
      await appendAuditEvent(
        auditEvent(
          "agent_decision",
          "Trade Watch Monitor Agent",
          `Opened trade-watch review for ${task.message.ticker ?? "unknown ticker"} in ${task.message.sector ?? "unknown sector"}.`,
          "info",
          { task: task.message }
        )
      );
      return processed(task, kind, "Trade watch task audited.");
    }
    await appendAuditEvent(
      auditEvent("system", "Redis Stream Worker Supervisor", `No specific handler for ${kind}; task acknowledged after audit.`, "info", {
        stream: task.stream,
        task: task.message
      })
    );
    return processed(task, kind, "Unknown task kind audited.");
  } catch (error) {
    return {
      stream: task.stream,
      id: task.id,
      kind,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function processed(task: RedisStreamTask, kind: string, detail: string): WorkerTaskResult {
  return {
    stream: task.stream,
    id: task.id,
    kind,
    status: "processed",
    detail
  };
}

function auditEvent(
  type: ActivityEvent["type"],
  actor: string,
  message: string,
  severity: ActivityEvent["severity"],
  payload?: Record<string, unknown>
): ActivityEvent {
  return {
    id: `audit-worker-${Date.now()}`,
    type,
    actor,
    message,
    severity,
    createdAt: new Date().toISOString(),
    payload
  };
}
