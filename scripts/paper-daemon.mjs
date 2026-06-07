const appUrl = (process.env.EVENTFUND_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const intervalMs = Math.max(10_000, Number(process.env.PAPER_DAEMON_INTERVAL_MS || 60_000));
const maxTicks = Number(process.env.PAPER_DAEMON_MAX_TICKS || 1);
const fetchTimeoutMs = Math.max(60_000, Number(process.env.PAPER_DAEMON_FETCH_TIMEOUT_MS || 300_000));
const token = process.env.OPERATOR_API_TOKEN;

let tick = 0;

async function runTick() {
  tick += 1;
  try {
    const response = await fetch(`${appUrl}/api/agents/daemon/tick`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(fetchTimeoutMs)
    });
    const body = await response.json().catch(() => ({}));
    console.log(JSON.stringify({ tick, status: response.status, body }, null, 2));
    if (!response.ok && response.status !== 409) {
      console.error(JSON.stringify({ tick, status: response.status, error: "paper daemon tick returned non-OK status", body }, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({
      tick,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      nextRetryInMs: intervalMs
    }, null, 2));
  }
}

while (maxTicks === 0 || tick < maxTicks) {
  await runTick();
  if (maxTicks !== 0 && tick >= maxTicks) break;
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
