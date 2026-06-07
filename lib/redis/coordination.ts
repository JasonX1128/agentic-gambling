import "server-only";

import type {
  ActivityEvent,
  BudgetCommitteeRecord,
  Opportunity,
  PodMemoryRecord,
  PortfolioPerformanceSnapshot,
  PortfolioSnapshot,
  TradeWatchTask
} from "@/lib/domain";
import { getRedisClient } from "@/lib/redis/client";
import { redisKeys } from "@/lib/redis/keys";

export type RedisStreamTask = {
  stream: string;
  id: string;
  message: Record<string, string>;
};

export async function requireRedisForTrading() {
  const client = await getRedisClient();
  await client.ping();
  return client;
}

export async function acquireLock(name: string, owner: string, ttlMs = 30_000): Promise<boolean> {
  const client = await requireRedisForTrading();
  const result = await client.set(redisKeys.lock(name), owner, { NX: true, PX: ttlMs });
  return result === "OK";
}

export async function releaseLock(name: string, owner: string): Promise<boolean> {
  const client = await requireRedisForTrading();
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;
  const result = await client.eval(script, { keys: [redisKeys.lock(name)], arguments: [owner] });
  return result === 1;
}

export async function withIdempotency<T>(key: string, fn: () => Promise<T>): Promise<{ replayed: boolean; value: T }> {
  const client = await requireRedisForTrading();
  const redisKey = redisKeys.idempotency(key);
  const existing = await client.get(redisKey);
  if (existing) return { replayed: true, value: JSON.parse(existing) as T };
  const value = await fn();
  await client.set(redisKey, JSON.stringify(value), { EX: 60 * 60 * 24 });
  return { replayed: false, value };
}

export async function publishEvent(channel: string, event: Record<string, unknown>) {
  const client = await requireRedisForTrading();
  await client.publish(redisKeys.eventChannel(channel), JSON.stringify(event));
}

export async function enqueueTask(streamName: string, task: Record<string, string>) {
  const client = await requireRedisForTrading();
  return client.xAdd(redisKeys.taskStream(streamName), "*", task);
}

export async function ensureTaskConsumerGroup(streamName: string, groupName: string, startId = "$") {
  const client = await requireRedisForTrading();
  try {
    await client.xGroupCreate(redisKeys.taskStream(streamName), groupName, startId, { MKSTREAM: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("BUSYGROUP")) throw error;
  }
}

export async function readTaskBatch(input: {
  streamName: string;
  groupName: string;
  consumerName: string;
  count?: number;
  blockMs?: number;
}): Promise<RedisStreamTask[]> {
  await ensureTaskConsumerGroup(input.streamName, input.groupName);
  const client = await requireRedisForTrading();
  const rows = await client.xReadGroup(
    input.groupName,
    input.consumerName,
    [{ key: redisKeys.taskStream(input.streamName), id: ">" }],
    {
      COUNT: input.count ?? 10,
      BLOCK: input.blockMs ?? 0
    }
  );
  if (!rows) return [];
  return rows.flatMap((stream) =>
    stream.messages.map((message) => ({
      stream: input.streamName,
      id: message.id,
      message: normalizeStreamMessage(message.message)
    }))
  );
}

export async function ackTask(streamName: string, groupName: string, taskId: string) {
  const client = await requireRedisForTrading();
  return client.xAck(redisKeys.taskStream(streamName), groupName, taskId);
}

export async function appendAuditEvent(event: ActivityEvent) {
  const client = await requireRedisForTrading();
  await client.lPush(redisKeys.audit(), JSON.stringify(event));
  await client.lTrim(redisKeys.audit(), 0, 199);
  await publishEvent("agent", { type: "audit", event });
}

export async function getAuditEvents(limit = 50): Promise<ActivityEvent[]> {
  const client = await getRedisClient();
  const rows = await client.lRange(redisKeys.audit(), 0, limit - 1);
  return rows.map((row) => JSON.parse(row) as ActivityEvent);
}

export async function savePortfolio(snapshot: PortfolioSnapshot) {
  const client = await requireRedisForTrading();
  await client.set(redisKeys.portfolio(), JSON.stringify(snapshot));
  await publishEvent("portfolio", { type: "portfolio.updated", snapshot });
}

export async function loadPortfolio(): Promise<PortfolioSnapshot | undefined> {
  const client = await getRedisClient();
  const value = await client.get(redisKeys.portfolio());
  return value ? (JSON.parse(value) as PortfolioSnapshot) : undefined;
}

export async function savePortfolioPerformanceSnapshot(record: PortfolioPerformanceSnapshot) {
  const client = await requireRedisForTrading();
  await client.hSet(redisKeys.portfolioSnapshot(record.id), {
    payload: JSON.stringify(record),
    portfolioId: record.portfolioId,
    reason: record.reason,
    netLiquidationValue: String(record.netLiquidationValue),
    totalPnl: String(record.totalPnl),
    openExposure: String(record.openExposure),
    createdAt: record.createdAt
  });
  await client.zAdd(redisKeys.portfolioSnapshotIndex(), {
    score: Date.parse(record.createdAt),
    value: record.id
  });
  await client.zRemRangeByRank(redisKeys.portfolioSnapshotIndex(), 0, -10001);
  await publishEvent("portfolio", { type: "portfolio.performance_snapshot", snapshot: record });
}

export async function loadPortfolioPerformanceSnapshots(limit = 1000): Promise<PortfolioPerformanceSnapshot[]> {
  const client = await getRedisClient();
  const ids = await client.zRange(redisKeys.portfolioSnapshotIndex(), 0, Math.max(0, limit - 1), { REV: true });
  const rows = await Promise.all(ids.map((id) => client.hGet(redisKeys.portfolioSnapshot(id), "payload")));
  return rows.filter(Boolean).map((row) => JSON.parse(row as string) as PortfolioPerformanceSnapshot);
}

export async function loadLatestPortfolioPerformanceSnapshot(): Promise<PortfolioPerformanceSnapshot | undefined> {
  const [latest] = await loadPortfolioPerformanceSnapshots(1);
  return latest;
}

export async function saveOpportunity(opportunity: Opportunity) {
  const client = await requireRedisForTrading();
  await client.hSet(redisKeys.opportunity(opportunity.id), {
    payload: JSON.stringify(opportunity),
    ticker: opportunity.market.ticker,
    sector: opportunity.sector,
    status: opportunity.status,
    score: String(opportunity.rankScore),
    createdAt: opportunity.createdAt
  });
  await client.zAdd(redisKeys.rankedOpportunities(), {
    score: opportunity.rankScore,
    value: opportunity.id
  });
}

export async function savePodMemoryRecord(record: PodMemoryRecord) {
  const client = await requireRedisForTrading();
  await client.hSet(redisKeys.memory(record.id), {
    payload: JSON.stringify(record),
    podId: record.podId,
    sector: record.sector,
    type: record.type,
    summary: record.summary,
    score: String(record.score),
    createdAt: record.createdAt
  });
  await client.zAdd(redisKeys.memoryIndex(), { score: Date.parse(record.createdAt), value: record.id });
  await client.zAdd(redisKeys.podMemoryIndex(record.sector), { score: record.score, value: record.id });
}

export async function loadPodMemoryRecords(limit = 40, sector?: string): Promise<PodMemoryRecord[]> {
  const client = await getRedisClient();
  const key = sector ? redisKeys.podMemoryIndex(sector) : redisKeys.memoryIndex();
  const ids = await client.zRange(key, 0, limit - 1, { REV: true });
  const rows = await Promise.all(ids.map((id) => client.hGet(redisKeys.memory(id), "payload")));
  return rows.filter(Boolean).map((row) => JSON.parse(row as string) as PodMemoryRecord);
}

export async function saveTradeWatchTask(task: TradeWatchTask) {
  const client = await requireRedisForTrading();
  await client.hSet(redisKeys.tradeWatchTask(task.id), {
    payload: JSON.stringify(task),
    orderId: task.orderId,
    ticker: task.ticker,
    sector: task.sector,
    status: task.status,
    dueAt: task.dueAt,
    createdAt: task.createdAt
  });
  await client.zAdd(redisKeys.tradeWatchIndex(), { score: Date.parse(task.createdAt), value: task.id });
}

export async function loadTradeWatchTasks(limit = 40): Promise<TradeWatchTask[]> {
  const client = await getRedisClient();
  const ids = await client.zRange(redisKeys.tradeWatchIndex(), 0, limit - 1, { REV: true });
  const rows = await Promise.all(ids.map((id) => client.hGet(redisKeys.tradeWatchTask(id), "payload")));
  return rows.filter(Boolean).map((row) => JSON.parse(row as string) as TradeWatchTask);
}

export async function appendBudgetCommitteeRecord(record: BudgetCommitteeRecord) {
  const client = await requireRedisForTrading();
  await client.lPush(redisKeys.budgetHistory(), JSON.stringify(record));
  await client.lTrim(redisKeys.budgetHistory(), 0, 199);
}

export async function loadBudgetCommitteeHistory(limit = 30): Promise<BudgetCommitteeRecord[]> {
  const client = await getRedisClient();
  const rows = await client.lRange(redisKeys.budgetHistory(), 0, limit - 1);
  return rows.map((row) => JSON.parse(row) as BudgetCommitteeRecord);
}

export async function appendOperatorAuditLog(entry: Record<string, unknown>) {
  const client = await requireRedisForTrading();
  await client.lPush(redisKeys.operatorAudit(), JSON.stringify({ ...entry, createdAt: new Date().toISOString() }));
  await client.lTrim(redisKeys.operatorAudit(), 0, 199);
  await publishEvent("alerts", { type: "operator.audit", entry });
}

function normalizeStreamMessage(message: Record<string, string | Buffer>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(message).map(([key, value]) => [key, Buffer.isBuffer(value) ? value.toString("utf8") : String(value)])
  );
}
