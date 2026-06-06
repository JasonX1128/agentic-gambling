import { z } from "zod";
import type { IntegrationStatus, RiskLimits, TradingMode } from "@/lib/domain";

const envSchema = z.object({
  TRADING_MODE: z.enum(["paper", "live"]).default("paper"),
  ENABLE_LIVE_TRADING: z.string().default("false"),
  GLOBAL_KILL_SWITCH: z.string().default("false"),
  ALLOW_DEMO_MARKETS: z.string().default("false"),
  KALSHI_BASE_URL: z.string().url().default("https://external-api.demo.kalshi.co/trade-api/v2"),
  KALSHI_API_KEY: z.string().optional(),
  KALSHI_PRIVATE_KEY: z.string().optional(),
  KALSHI_PRIVATE_KEY_PATH: z.string().optional(),
  KALSHI_API_SECRET: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_NAMESPACE: z.string().default("efos"),
  EVENTFUND_ENV: z.string().default("dev"),
  WANDB_API_KEY: z.string().optional(),
  WANDB_ENTITY: z.string().optional(),
  WANDB_PROJECT: z.string().default("eventfund-os-dev"),
  WEAVE_PROJECT: z.string().default("eventfund-os-dev"),
  WEAVE_DISABLED: z.string().default("false"),
  LLM_PROVIDER: z.enum(["ollama", "openai", "none"]).default("ollama"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434/v1"),
  OLLAMA_MODEL: z.string().default("qwen2.5:3b"),
  OLLAMA_API_KEY: z.string().default("ollama"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  MAX_DAILY_LOSS: z.coerce.number().default(500),
  MAX_WEEKLY_LOSS: z.coerce.number().default(1500),
  MAX_POSITION_SIZE: z.coerce.number().default(100),
  MAX_SECTOR_EXPOSURE: z.coerce.number().default(250),
  MAX_CORRELATED_EXPOSURE: z.coerce.number().default(350),
  MAX_OPEN_ORDERS: z.coerce.number().default(5),
  MAX_SLIPPAGE_BPS: z.coerce.number().default(150),
  MIN_LIQUIDITY: z.coerce.number().default(25),
  MIN_CONFIDENCE: z.coerce.number().default(0.55),
  MIN_EVIDENCE_QUALITY: z.coerce.number().default(0.55),
  MAX_RULE_AMBIGUITY: z.coerce.number().default(0.35),
  MAX_DRAWDOWN: z.coerce.number().default(1000),
  KELLY_FRACTION: z.coerce.number().default(0.2)
});

export function getEnv() {
  return envSchema.parse(process.env);
}

export function boolEnv(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

export function getTradingMode(): TradingMode {
  const env = getEnv();
  if (env.TRADING_MODE !== "live") return "paper";
  return livePrerequisites(env).ok ? "live" : "paper";
}

export function getRiskLimits(): RiskLimits {
  const env = getEnv();
  return {
    maxDailyLoss: env.MAX_DAILY_LOSS,
    maxWeeklyLoss: env.MAX_WEEKLY_LOSS,
    maxPositionSize: env.MAX_POSITION_SIZE,
    maxSectorExposure: env.MAX_SECTOR_EXPOSURE,
    maxCorrelatedExposure: env.MAX_CORRELATED_EXPOSURE,
    maxOpenOrders: env.MAX_OPEN_ORDERS,
    maxSlippageBps: env.MAX_SLIPPAGE_BPS,
    minLiquidity: env.MIN_LIQUIDITY,
    minConfidence: env.MIN_CONFIDENCE,
    minEvidenceQuality: env.MIN_EVIDENCE_QUALITY,
    maxRuleAmbiguity: env.MAX_RULE_AMBIGUITY,
    maxDrawdown: env.MAX_DRAWDOWN,
    kellyFraction: env.KELLY_FRACTION
  };
}

export function kalshiPrivateKeyConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.KALSHI_PRIVATE_KEY || env.KALSHI_PRIVATE_KEY_PATH || env.KALSHI_API_SECRET);
}

export function kalshiConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.KALSHI_API_KEY && kalshiPrivateKeyConfigured());
}

export function livePrerequisites(env = getEnv()): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (env.TRADING_MODE !== "live") missing.push("TRADING_MODE=live");
  if (!boolEnv(env.ENABLE_LIVE_TRADING)) missing.push("ENABLE_LIVE_TRADING=true");
  if (!env.KALSHI_API_KEY) missing.push("KALSHI_API_KEY");
  if (!kalshiPrivateKeyConfigured()) missing.push("KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH");
  if (!Number.isFinite(env.MAX_DAILY_LOSS) || env.MAX_DAILY_LOSS <= 0) missing.push("MAX_DAILY_LOSS");
  if (!Number.isFinite(env.MAX_POSITION_SIZE) || env.MAX_POSITION_SIZE <= 0) missing.push("MAX_POSITION_SIZE");
  if (!Number.isFinite(env.MAX_SECTOR_EXPOSURE) || env.MAX_SECTOR_EXPOSURE <= 0) {
    missing.push("MAX_SECTOR_EXPOSURE");
  }
  if (boolEnv(env.GLOBAL_KILL_SWITCH)) missing.push("GLOBAL_KILL_SWITCH=false");
  return { ok: missing.length === 0, missing };
}

export function staticIntegrationStatus(): IntegrationStatus[] {
  const env = getEnv();
  const live = livePrerequisites(env);
  const statuses: IntegrationStatus[] = [
    {
      name: "Kalshi",
      state: kalshiConfigured() ? "complete" : "blocked",
      detail: kalshiConfigured()
        ? "Kalshi credentials are configured; signed REST adapter can call market, portfolio, and order endpoints."
        : "Kalshi adapter is implemented, but authenticated API access is blocked by missing credentials.",
      required: ["KALSHI_API_KEY", "KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH", "KALSHI_BASE_URL"],
      remediation: [
        "Create a Kalshi API key in demo or production.",
        "Set KALSHI_API_KEY to the key id.",
        "Set KALSHI_PRIVATE_KEY to the PEM contents or KALSHI_PRIVATE_KEY_PATH to a local PEM file."
      ]
    },
    {
      name: "Redis",
      state: "degraded",
      detail: "Redis URL is configured; runtime health check verifies availability and modules.",
      required: ["REDIS_URL"],
      remediation: ["Run docker compose up redis or docker run -p 6379:6379 redis/redis-stack:latest."]
    },
    {
      name: "Weave",
      state: !boolEnv(env.WEAVE_DISABLED) && env.WANDB_API_KEY && (env.WEAVE_PROJECT || env.WANDB_PROJECT)
        ? "complete"
        : "blocked",
      detail: env.WANDB_API_KEY
        ? "Weave project variables are present; trading lifecycle ops can be traced."
        : "Weave tracing code is implemented, but W&B credentials are missing.",
      required: ["WANDB_API_KEY", "WEAVE_PROJECT or WANDB_PROJECT", "WANDB_ENTITY optional"],
      remediation: ["Set WANDB_API_KEY and WEAVE_PROJECT, then restart the app."]
    },
    {
      name: "CopilotKit",
      state: env.LLM_PROVIDER === "ollama" || env.OPENAI_API_KEY ? "complete" : "degraded",
      detail:
        env.LLM_PROVIDER === "ollama"
          ? `CopilotKit runtime is configured for free local Ollama via ${env.OLLAMA_BASE_URL} using ${env.OLLAMA_MODEL}.`
          : env.OPENAI_API_KEY
            ? "CopilotKit runtime and command actions are configured with an OpenAI model adapter."
            : "CopilotKit provider/actions are implemented, but no model provider is enabled.",
      required:
        env.LLM_PROVIDER === "ollama"
          ? ["Ollama running locally", "OLLAMA_MODEL pulled locally"]
          : ["OPENAI_API_KEY for OpenAI model-backed chat"],
      remediation:
        env.LLM_PROVIDER === "ollama"
          ? [
              "Install Ollama.",
              `Run: ollama pull ${env.OLLAMA_MODEL}`,
              "Run: ollama serve"
            ]
          : ["Set LLM_PROVIDER=ollama for a free local model or set OPENAI_API_KEY for OpenAI."]
    }
  ];
  return statuses.map((status) =>
    status.name === "Kalshi" && !live.ok && env.TRADING_MODE === "live"
      ? {
          ...status,
          detail: `${status.detail} Live trading remains disabled until: ${live.missing.join(", ")}.`
        }
      : status
  );
}
