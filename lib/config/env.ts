import { z } from "zod";
import type { IntegrationStatus, RiskLimits, TradingMode } from "@/lib/domain";

const envSchema = z.object({
  TRADING_MODE: z.enum(["paper", "live"]).default("paper"),
  ENABLE_LIVE_TRADING: z.string().default("false"),
  GLOBAL_KILL_SWITCH: z.string().default("false"),
  ALLOW_DEMO_MARKETS: z.string().default("false"),
  KALSHI_BASE_URL: z.string().url().default("https://external-api.kalshi.com/trade-api/v2"),
  KALSHI_API_KEY: z.string().optional(),
  KALSHI_PRIVATE_KEY: z.string().optional(),
  KALSHI_PRIVATE_KEY_PATH: z.string().optional(),
  KALSHI_API_SECRET: z.string().optional(),
  KALSHI_MARKET_SCAN_LIMIT: z.coerce.number().default(8000),
  KALSHI_MARKET_SCAN_RESULT_LIMIT: z.coerce.number().default(240),
  KALSHI_MARKET_SCAN_MIN_PER_POD: z.coerce.number().default(10),
  KALSHI_MARKET_CACHE_TTL_MS: z.coerce.number().default(60000),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_NAMESPACE: z.string().default("efos"),
  EVENTFUND_ENV: z.string().default("dev"),
  OPERATOR_API_TOKEN: z.string().optional(),
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
  MAX_DAILY_LOSS: z.coerce.number().default(1000),
  MAX_WEEKLY_LOSS: z.coerce.number().default(3000),
  MAX_POSITION_SIZE: z.coerce.number().default(250),
  MAX_SECTOR_EXPOSURE: z.coerce.number().default(1000),
  MAX_CORRELATED_EXPOSURE: z.coerce.number().default(1500),
  MAX_OPEN_ORDERS: z.coerce.number().default(20),
  MAX_SLIPPAGE_BPS: z.coerce.number().default(10000),
  MIN_LIQUIDITY: z.coerce.number().default(1),
  MIN_CONFIDENCE: z.coerce.number().default(0.35),
  MIN_EVIDENCE_QUALITY: z.coerce.number().default(0.4),
  MAX_RULE_AMBIGUITY: z.coerce.number().default(0.6),
  MAX_DRAWDOWN: z.coerce.number().default(2000),
  KELLY_FRACTION: z.coerce.number().default(0.25),
  RISK_AGENT_MAX_POSITION_SIZE: z.coerce.number().default(50),
  RISK_AGENT_TARGET_SECTOR_EXPOSURE: z.coerce.number().default(250),
  RISK_AGENT_TARGET_LIQUIDITY: z.coerce.number().default(100),
  RISK_AGENT_TARGET_CONFIDENCE: z.coerce.number().default(0.62),
  RISK_AGENT_TARGET_SLIPPAGE_BPS: z.coerce.number().default(150),
  RISK_AGENT_MAX_RISK_SCORE: z.coerce.number().default(65),
  PAPER_AGENT_MAX_TRADES_PER_CYCLE: z.coerce.number().default(60),
  PAPER_AGENT_MIN_CYCLE_SCORE: z.coerce.number().default(0),
  PAPER_AGENT_MIN_SCAN_HORIZON_MS: z.coerce.number().default(300000),
  PAPER_DAEMON_ENABLED: z.string().default("false"),
  PAPER_DAEMON_INTERVAL_MS: z.coerce.number().default(60000),
  PAPER_DAEMON_MAX_TICKS: z.coerce.number().default(1),
  PAPER_DAEMON_WORKER_BATCH_SIZE: z.coerce.number().default(8),
  AGENT_POLICY_AUTOPILOT_APPLY: z.string().default("false"),
  BROWSER_RESEARCH_ENABLED: z.string().default("false"),
  BROWSER_RESEARCH_ENDPOINT: z.string().url().optional(),
  BROWSER_RESEARCH_API_KEY: z.string().optional(),
  BROWSER_RESEARCH_TIMEOUT_MS: z.coerce.number().default(12000),
  THE_ODDS_API_KEY: z.string().optional(),
  THE_ODDS_API_BASE_URL: z.string().url().default("https://api.the-odds-api.com"),
  THE_ODDS_API_REGIONS: z.string().default("us"),
  THE_ODDS_API_MARKETS: z.string().default("h2h,spreads,totals")
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
    kellyFraction: env.KELLY_FRACTION,
    riskAgentMaxPositionSize: env.RISK_AGENT_MAX_POSITION_SIZE,
    riskAgentTargetSectorExposure: env.RISK_AGENT_TARGET_SECTOR_EXPOSURE,
    riskAgentTargetLiquidity: env.RISK_AGENT_TARGET_LIQUIDITY,
    riskAgentTargetConfidence: env.RISK_AGENT_TARGET_CONFIDENCE,
    riskAgentTargetSlippageBps: env.RISK_AGENT_TARGET_SLIPPAGE_BPS,
    riskAgentMaxRiskScore: env.RISK_AGENT_MAX_RISK_SCORE
  };
}

export function getPaperCycleConfig() {
  const env = getEnv();
  return {
    maxTradesPerCycle: Math.max(1, Math.floor(env.PAPER_AGENT_MAX_TRADES_PER_CYCLE)),
    minCycleScore: env.PAPER_AGENT_MIN_CYCLE_SCORE,
    minScanHorizonMs: Math.max(60_000, Math.floor(env.PAPER_AGENT_MIN_SCAN_HORIZON_MS))
  };
}

export function getKalshiMarketScanConfig() {
  const env = getEnv();
  return {
    scanLimit: Math.max(100, Math.min(12000, Math.floor(env.KALSHI_MARKET_SCAN_LIMIT))),
    resultLimit: Math.max(20, Math.floor(env.KALSHI_MARKET_SCAN_RESULT_LIMIT)),
    minPerPod: Math.max(1, Math.floor(env.KALSHI_MARKET_SCAN_MIN_PER_POD)),
    cacheTtlMs: Math.max(0, Math.floor(env.KALSHI_MARKET_CACHE_TTL_MS))
  };
}

export function getAgentAutomationConfig() {
  const env = getEnv();
  return {
    paperDaemonEnabled: boolEnv(env.PAPER_DAEMON_ENABLED),
    paperDaemonIntervalMs: Math.max(10_000, Math.floor(env.PAPER_DAEMON_INTERVAL_MS)),
    paperDaemonMaxTicks: Math.max(1, Math.floor(env.PAPER_DAEMON_MAX_TICKS)),
    paperDaemonWorkerBatchSize: Math.max(1, Math.floor(env.PAPER_DAEMON_WORKER_BATCH_SIZE)),
    agentPolicyAutopilotApply: boolEnv(env.AGENT_POLICY_AUTOPILOT_APPLY),
    operatorAuthConfigured: Boolean(env.OPERATOR_API_TOKEN),
    operatorAuthRequired: env.EVENTFUND_ENV === "production" || Boolean(env.OPERATOR_API_TOKEN)
  };
}

export function getBrowserResearchConfig() {
  const env = getEnv();
  return {
    enabled: boolEnv(env.BROWSER_RESEARCH_ENABLED),
    endpoint: env.BROWSER_RESEARCH_ENDPOINT,
    apiKey: env.BROWSER_RESEARCH_API_KEY,
    timeoutMs: Math.max(1500, Math.floor(env.BROWSER_RESEARCH_TIMEOUT_MS)),
    oddsApiKey: env.THE_ODDS_API_KEY,
    oddsApiBaseUrl: env.THE_ODDS_API_BASE_URL.replace(/\/$/, ""),
    oddsRegions: env.THE_ODDS_API_REGIONS,
    oddsMarkets: env.THE_ODDS_API_MARKETS
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
