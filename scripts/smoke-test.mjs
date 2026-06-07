import fs from "fs";

const requiredFiles = [
  "lib/kalshi/client.ts",
  "lib/redis/coordination.ts",
  "lib/observability/weave.ts",
  "lib/llm/health.ts",
  "lib/agents/paper-cycle.ts",
  "lib/agents/daemon.ts",
  "lib/agents/workers.ts",
  "lib/agents/learning.ts",
  "lib/agents/reconciliation.ts",
  "lib/agents/executive-committee.ts",
  "lib/agents/fund-management.ts",
  "lib/agents/operating-policy.ts",
  "lib/markets/universe.ts",
  "config/agent-operating-policy.json",
  "app/api/copilotkit/[[...slug]]/route.ts",
  "app/api/agents/paper-cycle/route.ts",
  "app/api/agents/daemon/tick/route.ts",
  "app/api/agents/workers/run-once/route.ts",
  "app/api/research/browser/[id]/route.ts",
  "app/api/agents/learning/propose/route.ts",
  "app/api/agents/reconciliation/run/route.ts",
  "app/api/agents/executive-review/run/route.ts",
  "app/api/agents/governance/route.ts",
  "app/api/agents/policy/route.ts",
  "app/api/health/route.ts",
  "app/api/portfolio/mark-to-market/route.ts",
  "app/api/trades/[id]/close/route.ts",
  "app/api/trades/[id]/settle/route.ts",
  "components/copilot/EventFundCopilotActions.tsx",
  "lib/risk/engine.ts",
  "lib/risk/event-cluster.ts",
  "lib/research/browser-agent.ts",
  "lib/security/operator-auth.ts",
  "lib/compliance/engine.ts",
  "lib/execution/engine.ts",
  "Dockerfile",
  ".env.cloud.example",
  "scripts/cloud-preflight.mjs",
  "README.md",
  "docs/integration-status.md"
];

let failed = false;
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}`);
    failed = true;
  }
}

const execution = fs.readFileSync("lib/execution/engine.ts", "utf8");
const config = fs.readFileSync("lib/config/env.ts", "utf8");
const nextConfig = fs.readFileSync("next.config.mjs", "utf8");
const copilotRoute = fs.readFileSync("app/api/copilotkit/[[...slug]]/route.ts", "utf8");
const copilotActions = fs.readFileSync("components/copilot/EventFundCopilotActions.tsx", "utf8");
const portfolio = fs.readFileSync("lib/portfolio/engine.ts", "utf8");
const daemon = fs.readFileSync("lib/agents/daemon.ts", "utf8");
const workers = fs.readFileSync("lib/agents/workers.ts", "utf8");
const learning = fs.readFileSync("lib/agents/learning.ts", "utf8");
const quant = fs.readFileSync("lib/quant/scoring.ts", "utf8");
const marketService = fs.readFileSync("lib/services/market-service.ts", "utf8");
const marketUniverse = fs.readFileSync("lib/markets/universe.ts", "utf8");
const browserResearch = fs.readFileSync("lib/research/browser-agent.ts", "utf8");
const risk = fs.readFileSync("lib/risk/engine.ts", "utf8");
const operatorAuth = fs.readFileSync("lib/security/operator-auth.ts", "utf8");
const operatingPolicy = fs.readFileSync("lib/agents/operating-policy.ts", "utf8");
const policyConfig = fs.readFileSync("config/agent-operating-policy.json", "utf8");
const dockerfile = fs.readFileSync("Dockerfile", "utf8");
const healthRoute = fs.readFileSync("app/api/health/route.ts", "utf8");
const approveStart = execution.indexOf("export async function approvePaperTrade");
const liveStart = execution.indexOf("export async function executeLiveTrade");
const approveBlock = execution.slice(approveStart, liveStart);

const checks = [
  ["paper execution does not call Kalshi", approveBlock.includes("approvePaperTrade") && !approveBlock.includes("createOrder")],
  ["live execution requires approval token", execution.includes("LIVE_GATE_REQUIRED")],
  ["live prerequisites include kill switch", config.includes("GLOBAL_KILL_SWITCH=false")],
  [
    "CopilotKit default agent route exists",
    copilotRoute.includes("CopilotRuntime") &&
      copilotRoute.includes("BuiltInAgent") &&
      copilotRoute.includes("createCopilotRuntimeHandler") &&
      copilotRoute.includes("default")
  ],
  ["CopilotKit action surface includes paper approval", copilotActions.includes("approvePaperTrade")],
  ["CopilotKit action surface includes browser research", copilotActions.includes("runBrowserResearchForTrade")],
  ["CopilotKit action surface includes agent paper cycle", copilotActions.includes("runAgentPaperCycle")],
  ["CopilotKit action surface includes daemon and workers", copilotActions.includes("runContinuousPaperDaemonTick") && copilotActions.includes("runRedisFundWorkersOnce")],
  ["CopilotKit action surface includes paper close", copilotActions.includes("closePaperPosition")],
  ["CopilotKit action surface includes paper settlement", copilotActions.includes("settlePaperPosition")],
  ["CopilotKit action surface includes pod governance query", copilotActions.includes("queryPodGovernance")],
  ["CopilotKit action surface includes operating policy tools", copilotActions.includes("readAgentOperatingPolicy") && copilotActions.includes("applyAgentPolicyPatch")],
  ["portfolio accounting separates settled and unrealized PnL", portfolio.includes("settledPnl") && portfolio.includes("unrealizedPnl")],
  ["continuous paper daemon enqueues worker tasks", daemon.includes("runPaperTradingDaemonTick") && daemon.includes("enqueueDaemonTasks")],
  ["Redis Stream workers consume fund queues", workers.includes("readTaskBatch") && workers.includes("ackTask") && workers.includes("runPaperCycle")],
  ["paper iteration defaults are faster", config.includes("PAPER_AGENT_MAX_TRADES_PER_CYCLE: z.coerce.number().default(12)") && config.includes("PAPER_DAEMON_INTERVAL_MS: z.coerce.number().default(60000)")],
  ["short-horizon urgency scoring is wired", quant.includes("resolutionUrgencyScore") && marketUniverse.includes("resolutionUrgencyScore") && marketService.includes("marketScanPriority") && policyConfig.includes("resolutionUrgencyWeight")],
  ["quick-settle arithmetic markets are excluded", marketUniverse.includes("KXQUICKSETTLE") && marketUniverse.includes("isExcludedTradingUniverseMarket")],
  ["agent learning proposes policy changes", learning.includes("buildPaperCycleLearningProposal") && learning.includes("agentPolicyAutopilotApply")],
  ["browser research agent can attach odds evidence", browserResearch.includes("Browser Research Agent") && browserResearch.includes("oddsApiKey") && browserResearch.includes("attachBrowserResearchToOpportunity")],
  ["risk engine checks event-cluster exposure", risk.includes("MAX_CORRELATED_EXPOSURE") && risk.includes("eventClusterExposure")],
  ["production mutating APIs require operator auth", operatorAuth.includes("OPERATOR_API_TOKEN") && operatorAuth.includes("Authorization: Bearer")],
  ["agent operating policy file protects live gates", policyConfig.includes("GLOBAL_KILL_SWITCH") && policyConfig.includes("liveTradingEditPolicy")],
  ["agent operating policy enforces section permissions", operatingPolicy.includes("requiredPermissionForSection") && operatingPolicy.includes("apply_governance_policy")],
  ["executive roster replaces compliance exec without vacancy", policyConfig.includes("Interim Compliance Officer Agent") && policyConfig.includes("cannotVacateSeats")],
  ["operating policy validates protected executive seats", operatingPolicy.includes("validateExecutiveRoster") && operatingPolicy.includes("cannot leave required protected seat")],
  ["Next standalone output is cloud-flag controlled", nextConfig.includes("EVENTFUND_DEPLOY_TARGET") && nextConfig.includes("output: \"standalone\"")],
  ["cloud Dockerfile uses flagged Next standalone runtime", dockerfile.includes("EVENTFUND_DEPLOY_TARGET=cloud") && dockerfile.includes("build:cloud") && dockerfile.includes(".next/standalone") && dockerfile.includes("server.js")],
  ["cloud health endpoint reports integration readiness", healthRoute.includes("readiness") && healthRoute.includes("redisHealth") && healthRoute.includes("copilotKitHealth")]
];

for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
