import "server-only";

import type { ActivityEvent, Opportunity, PortfolioSnapshot } from "@/lib/domain";
import { getRedisClient } from "@/lib/redis/client";
import { redisKeys } from "@/lib/redis/keys";

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
