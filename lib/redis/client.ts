import "server-only";

import { createClient, type RedisClientType } from "redis";
import { getEnv } from "@/lib/config/env";
import type { IntegrationStatus } from "@/lib/domain";

const globalForRedis = globalThis as unknown as {
  redisClient?: RedisClientType;
  redisConnectPromise?: Promise<RedisClientType>;
};

export async function getRedisClient(): Promise<RedisClientType> {
  if (globalForRedis.redisClient?.isOpen) return globalForRedis.redisClient;
  if (globalForRedis.redisConnectPromise) return globalForRedis.redisConnectPromise;

  const env = getEnv();
  const client = createClient({
    url: env.REDIS_URL,
    socket: {
      connectTimeout: 750,
      reconnectStrategy: false
    }
  }) as RedisClientType;
  client.on("error", () => {
    // Health endpoints surface connection failures without leaking connection secrets.
  });
  globalForRedis.redisConnectPromise = client
    .connect()
    .then(() => {
      globalForRedis.redisClient = client;
      return client;
    })
    .catch((error) => {
      globalForRedis.redisConnectPromise = undefined;
      throw error;
    });
  return globalForRedis.redisConnectPromise;
}

export async function redisHealth(): Promise<IntegrationStatus> {
  try {
    const client = await getRedisClient();
    const pong = await client.ping();
    const moduleList = await client.sendCommand(["MODULE", "LIST"]).catch(() => []);
    const jsonAvailable = await client.sendCommand(["COMMAND", "INFO", "JSON.SET"]).then(Boolean).catch(() => false);
    const searchAvailable = await client.sendCommand(["COMMAND", "INFO", "FT.CREATE"]).then(Boolean).catch(() => false);
    return {
      name: "Redis",
      state: pong === "PONG" ? "complete" : "blocked",
      detail: `Redis responded ${pong}. RedisJSON=${jsonAvailable ? "yes" : "no"}, RediSearch=${searchAvailable ? "yes" : "no"}, modules=${Array.isArray(moduleList) ? moduleList.length : "unknown"}.`,
      required: ["REDIS_URL"],
      remediation: [
        "Run docker compose up redis.",
        "For vector/search memory, use redis/redis-stack:latest so JSON.SET and FT.CREATE are available."
      ]
    };
  } catch (error) {
    const detail =
      error instanceof Error && error.message
        ? error.message
        : typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "connection failed or timed out";
    return {
      name: "Redis",
      state: "blocked",
      detail: `Redis unavailable: ${detail}`,
      required: ["REDIS_URL"],
      remediation: [
        "Start Redis with: docker run --name efos-redis-stack -p 6379:6379 -p 8001:8001 redis/redis-stack:latest",
        "Set REDIS_URL=redis://localhost:6379 and restart the app."
      ]
    };
  }
}
