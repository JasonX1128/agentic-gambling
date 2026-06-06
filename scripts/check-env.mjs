const requiredForLive = [
  "TRADING_MODE=live",
  "ENABLE_LIVE_TRADING=true",
  "KALSHI_API_KEY",
  "KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH",
  "MAX_DAILY_LOSS",
  "MAX_POSITION_SIZE",
  "MAX_SECTOR_EXPOSURE",
  "GLOBAL_KILL_SWITCH=false"
];

const env = process.env;
const missing = [];

if (env.TRADING_MODE === "live") {
  if (env.ENABLE_LIVE_TRADING !== "true") missing.push("ENABLE_LIVE_TRADING=true");
  if (!env.KALSHI_API_KEY) missing.push("KALSHI_API_KEY");
  if (!env.KALSHI_PRIVATE_KEY && !env.KALSHI_PRIVATE_KEY_PATH && !env.KALSHI_API_SECRET) {
    missing.push("KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH");
  }
  for (const key of ["MAX_DAILY_LOSS", "MAX_POSITION_SIZE", "MAX_SECTOR_EXPOSURE"]) {
    if (!env[key] || Number(env[key]) <= 0) missing.push(key);
  }
  if (env.GLOBAL_KILL_SWITCH !== "false") missing.push("GLOBAL_KILL_SWITCH=false");
}

console.log("EventFund OS environment check");
console.log(`Trading mode: ${env.TRADING_MODE || "paper"}`);
console.log(`Redis URL configured: ${Boolean(env.REDIS_URL || "redis://localhost:6379")}`);
console.log(`Kalshi configured: ${Boolean(env.KALSHI_API_KEY && (env.KALSHI_PRIVATE_KEY || env.KALSHI_PRIVATE_KEY_PATH || env.KALSHI_API_SECRET))}`);
console.log(`Weave configured: ${Boolean(env.WANDB_API_KEY && (env.WEAVE_PROJECT || env.WANDB_PROJECT))}`);
console.log(`CopilotKit provider: ${env.LLM_PROVIDER || "ollama"}`);
console.log(
  `CopilotKit model configured: ${
    (env.LLM_PROVIDER || "ollama") === "ollama"
      ? `local Ollama ${env.OLLAMA_MODEL || "qwen2.5:3b"}`
      : Boolean(env.OPENAI_API_KEY)
  }`
);

if (missing.length) {
  console.log("Live trading blocked. Missing:");
  for (const item of missing) console.log(`- ${item}`);
  process.exitCode = 1;
} else if (env.TRADING_MODE === "live") {
  console.log("Live trading prerequisites are present. Per-order approval, Redis, risk, and compliance gates still apply.");
} else {
  console.log("Paper mode active. Live prerequisites, if needed, are:");
  for (const item of requiredForLive) console.log(`- ${item}`);
}
