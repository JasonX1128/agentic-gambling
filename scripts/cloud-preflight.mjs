const env = process.env;
const blockers = [];
const warnings = [];

function requireValue(key, description = key) {
  if (!env[key]) blockers.push(description);
}

function isTruthy(value) {
  return value === "true" || value === "1" || value === "yes";
}

function provider() {
  return env.LLM_PROVIDER || "ollama";
}

if ((env.EVENTFUND_ENV || "dev") === "dev") {
  warnings.push("EVENTFUND_ENV is dev; set EVENTFUND_ENV=production for cloud.");
}
if ((env.EVENTFUND_DEPLOY_TARGET || "local") !== "cloud") {
  warnings.push("EVENTFUND_DEPLOY_TARGET is not cloud; set EVENTFUND_DEPLOY_TARGET=cloud for standalone container builds.");
}

if (env.TRADING_MODE === "live") {
  if (!isTruthy(env.ENABLE_LIVE_TRADING)) blockers.push("ENABLE_LIVE_TRADING=true for live mode");
  if (isTruthy(env.GLOBAL_KILL_SWITCH)) blockers.push("GLOBAL_KILL_SWITCH=false for live mode");
  for (const key of ["MAX_DAILY_LOSS", "MAX_POSITION_SIZE", "MAX_SECTOR_EXPOSURE"]) {
    if (!env[key] || Number(env[key]) <= 0) blockers.push(key);
  }
} else {
  if (isTruthy(env.ENABLE_LIVE_TRADING)) warnings.push("ENABLE_LIVE_TRADING=true is ignored while TRADING_MODE is not live.");
}

if (isTruthy(env.ALLOW_DEMO_MARKETS)) {
  blockers.push("ALLOW_DEMO_MARKETS=false for cloud paper launch");
}

requireValue("REDIS_URL", "REDIS_URL managed Redis connection string");
requireValue("KALSHI_API_KEY");
if (!env.KALSHI_PRIVATE_KEY && !env.KALSHI_PRIVATE_KEY_PATH && !env.KALSHI_API_SECRET) {
  blockers.push("KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH");
}
requireValue("WANDB_API_KEY");
if (!env.WEAVE_PROJECT && !env.WANDB_PROJECT) blockers.push("WEAVE_PROJECT or WANDB_PROJECT");

if (provider() === "ollama") {
  requireValue("OLLAMA_BASE_URL", "OLLAMA_BASE_URL reachable from the cloud service");
  if ((env.OLLAMA_BASE_URL || "").includes("localhost") || (env.OLLAMA_BASE_URL || "").includes("127.0.0.1")) {
    blockers.push("OLLAMA_BASE_URL must not be localhost in cloud unless Ollama runs in the same deployed container");
  }
  requireValue("OLLAMA_MODEL");
} else if (provider() === "openai") {
  requireValue("OPENAI_API_KEY");
} else {
  blockers.push("LLM_PROVIDER=ollama or LLM_PROVIDER=openai");
}

console.log("EventFund OS cloud preflight");
console.log(`Trading mode: ${env.TRADING_MODE || "paper"}`);
console.log(`EventFund env: ${env.EVENTFUND_ENV || "dev"}`);
console.log(`Deploy target: ${env.EVENTFUND_DEPLOY_TARGET || "local"}`);
console.log(`CopilotKit model provider: ${provider()}`);
console.log(`Redis configured: ${Boolean(env.REDIS_URL)}`);
console.log(`Kalshi configured: ${Boolean(env.KALSHI_API_KEY && (env.KALSHI_PRIVATE_KEY || env.KALSHI_PRIVATE_KEY_PATH || env.KALSHI_API_SECRET))}`);
console.log(`Weave configured: ${Boolean(env.WANDB_API_KEY && (env.WEAVE_PROJECT || env.WANDB_PROJECT))}`);

if (warnings.length) {
  console.log("\nWarnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (blockers.length) {
  console.log("\nCloud launch blocked until:");
  for (const blocker of blockers) console.log(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log("\nCloud preflight passed. Keep TRADING_MODE=paper until an operator intentionally enables live gates.");
}
