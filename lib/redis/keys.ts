import { getEnv } from "@/lib/config/env";

export function redisKey(...parts: string[]): string {
  const env = getEnv();
  return [env.REDIS_NAMESPACE, `{${env.EVENTFUND_ENV}}`, ...parts].join(":");
}

export const redisKeys = {
  taskStream: (name: string) => redisKey("tasks", name),
  eventChannel: (name: string) => redisKey("events", name),
  portfolio: (portfolioId = "main") => redisKey("portfolio", portfolioId),
  positions: (portfolioId = "main") => redisKey("portfolio", portfolioId, "positions"),
  orders: (portfolioId = "main") => redisKey("portfolio", portfolioId, "orders"),
  audit: () => redisKey("audit"),
  marketSnapshot: (ticker: string) => redisKey("market", "snapshot", ticker),
  opportunity: (id: string) => redisKey("opportunity", id),
  rankedOpportunities: () => redisKey("opportunities", "ranked"),
  riskLimits: (portfolioId = "main") => redisKey("risk", "limits", portfolioId),
  lock: (name: string) => redisKey("lock", name),
  idempotency: (key: string) => redisKey("idempotency", key),
  agentHeartbeat: (agentId: string) => redisKey("agent", agentId, "heartbeat"),
  memory: (id: string) => redisKey("memory", id)
};
