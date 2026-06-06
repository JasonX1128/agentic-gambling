import fs from "fs";

const requiredFiles = [
  "lib/kalshi/client.ts",
  "lib/redis/coordination.ts",
  "lib/observability/weave.ts",
  "lib/llm/health.ts",
  "app/api/copilotkit/[[...slug]]/route.ts",
  "components/copilot/EventFundCopilotActions.tsx",
  "lib/risk/engine.ts",
  "lib/compliance/engine.ts",
  "lib/execution/engine.ts",
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
const copilotRoute = fs.readFileSync("app/api/copilotkit/[[...slug]]/route.ts", "utf8");
const copilotActions = fs.readFileSync("components/copilot/EventFundCopilotActions.tsx", "utf8");
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
  ["CopilotKit action surface includes paper approval", copilotActions.includes("approvePaperTrade")]
];

for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
