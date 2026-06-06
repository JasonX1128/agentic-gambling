# EventFund OS

EventFund OS is a production-minded command center for a configurable multi-agent Kalshi event-contract fund. It defaults to paper trading, exposes the live trading path only behind explicit environment flags, and keeps risk, compliance, Redis coordination, Weave tracing, and CopilotKit controls visible.

This repo was created as a greenfield implementation in an empty workspace.

## What Is Included

- Next.js App Router command center, not a landing page.
- Real Kalshi REST adapter with RSA-PSS request signing.
- Redis coordination layer for Streams, Pub/Sub, idempotency, audit events, portfolio state, and ranked opportunities.
- W&B Weave tracing integration with safe missing-credential degradation.
- CopilotKit runtime, sidebar, readable state, and trading control actions.
- Multi-agent trading hierarchy: CIO, CRO, compliance, research director, execution supervisor, and dynamic sector pods.
- Dynamic pod governance: research scouts propose new pods, pods resize analyst headcount, losing pods move to PIP/defense, and idle scouts sleep until new markets appear.
- File-backed agent operating policy at `config/agent-operating-policy.json` for prompts, role rights, sector rules, pod lifecycle thresholds, analyst allocation, scout sleep cadence, proposal thresholds, and paper-cycle scoring.
- Executive roster governance: required seats can be replaced, but protected control functions such as compliance, risk, and execution cannot be left vacant.
- Quant scoring: market-implied probability, fair probability, EV, confidence, liquidity quality, capped Kelly sizing, Brier/calibration helpers.
- Paper trading engine that updates Redis-backed portfolio state.
- CIO-driven paper cycle endpoint that ranks opportunities, enqueues Redis Stream tasks, writes audit events, and executes the approved paper slate.
- Paper close, settlement, mark-to-market, realized/unrealized/settled PnL, and Brier/calibration accounting.
- Live order path present but blocked unless every live prerequisite is satisfied.
- Risk/compliance engines that block unsafe trades server-side.

## Run Locally

```bash
npm install
cp .env.example .env.local
docker run --name efos-redis-stack -p 6379:6379 -p 8001:8001 redis/redis-stack:latest
npm run dev
```

Open `http://localhost:3000`.

If Redis is not running, the UI still explains status, but paper execution and risk-limit changes are blocked because Redis is mandatory for idempotency, state, and auditability.

Recommended Node runtime: Node `20.19+` or `22.13+`. The app verified locally on Node `20.17.0`, but npm reports an engine warning from a transitive ESLint package.

## Move To Cloud

This repo now includes a Docker-first cloud deployment path. Use `Dockerfile` for Railway, Render, Fly, or AWS ECS. Railway also has a starter `railway.toml`.

```bash
cp .env.cloud.example .env.production
npm run cloud:preflight
docker build -t eventfund-os .
```

Cloud health endpoint:

```bash
curl https://YOUR_APP_URL/api/health
```

See `docs/cloud-deployment.md`. Actual deployment is blocked until cloud account access, managed `REDIS_URL`, Kalshi credentials, W&B/Weave credentials, and a reachable CopilotKit model backend are available in the cloud secret store.

## Verification

```bash
npm run typecheck
npm run test
npm run smoke
npm run check:env
```

Current production audit note: `npm audit --omit=dev` reports low/moderate upstream findings in CopilotKit's `@ai-sdk/*` dependency chain and Next's nested PostCSS. `npm audit fix --force` proposes breaking downgrades, so this repo keeps the mandatory integrations current, patches safe direct/transitive packages where possible, and documents the residual upstream advisories in `docs/integration-status.md`.

## Mandatory Environment Variables

Paper mode is default:

```env
TRADING_MODE=paper
ENABLE_LIVE_TRADING=false
GLOBAL_KILL_SWITCH=false
ALLOW_DEMO_MARKETS=false
REDIS_URL=redis://localhost:6379
```

Kalshi market data and authenticated access:

```env
KALSHI_BASE_URL=https://external-api.demo.kalshi.co/trade-api/v2
KALSHI_API_KEY=...
KALSHI_PRIVATE_KEY=...
```

Public market discovery uses the Kalshi REST API without signing. Account reads, portfolio reads, and all live-order paths require a valid API key and RSA private key. You may set `KALSHI_PRIVATE_KEY_PATH` instead of inline PEM. `KALSHI_API_SECRET` is accepted as a compatibility alias, but Kalshi uses an RSA private key.

Weave:

```env
WANDB_API_KEY=...
WANDB_ENTITY=...
WEAVE_PROJECT=eventfund-os-dev
```

Free CopilotKit model-backed chat with Ollama:

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_API_KEY=ollama
COPILOTKIT_TELEMETRY_DISABLED=true
```

Optional CopilotKit Premium/Cloud key:

```env
NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY=...
# or, for Copilot Cloud:
NEXT_PUBLIC_COPILOTKIT_API_KEY=...
```

`npx copilotkit@latest license` issues or lists CopilotKit license keys. A free Developer-tier key can unlock CopilotKit premium UI/platform features such as inspector, headless UI, and CopilotKit observability hooks; it does not replace Ollama or make the local model smarter.

Run the local model:

```bash
ollama pull qwen2.5:3b
ollama serve
```

Optional paid fallback:

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
```

Live trading only activates when all are present:

```env
TRADING_MODE=live
ENABLE_LIVE_TRADING=true
KALSHI_API_KEY=...
KALSHI_PRIVATE_KEY=...
MAX_DAILY_LOSS=1000
MAX_POSITION_SIZE=250
MAX_SECTOR_EXPOSURE=1000
GLOBAL_KILL_SWITCH=false
```

Every live order still requires an explicit approval token, Redis idempotency, risk approval, compliance approval, and Kalshi credentials.

Hard risk limits are broad circuit breakers. The default slippage rail is intentionally loose for paper calibration, while the Risk Agent's spread target remains strict. The Risk Agent applies target policy for sizing, spread, liquidity, confidence, and portfolio crowding, and can negotiate smaller paper probes without pretending the hard limits were breached.

Paper-cycle defaults are intentionally loose for early calibration volume:

```env
PAPER_AGENT_MAX_TRADES_PER_CYCLE=5
PAPER_AGENT_MIN_CYCLE_SCORE=0
RISK_AGENT_MAX_POSITION_SIZE=50
RISK_AGENT_TARGET_CONFIDENCE=0.62
```

Run one agent-selected paper cycle:

```bash
curl -X POST http://localhost:3000/api/agents/paper-cycle
```

Refresh paper marks from current Kalshi market data:

```bash
curl -X POST http://localhost:3000/api/portfolio/mark-to-market
```

Close or settle a paper position:

```bash
curl -X POST http://localhost:3000/api/trades/KXEXAMPLE/close \
  -H 'content-type: application/json' \
  -d '{"exitPrice":55,"reason":"risk taking profit"}'

curl -X POST http://localhost:3000/api/trades/KXEXAMPLE/settle \
  -H 'content-type: application/json' \
  -d '{"outcome":"yes","notes":"Kalshi settlement source resolved yes"}'
```

PnL semantics:

- `unrealizedPnl`: open paper mark-to-market PnL.
- `closedPnl`: realized PnL from explicit paper closes.
- `settledPnl`: realized PnL from recorded paper outcomes.
- `realizedPnl`: `closedPnl + settledPnl`.
- `totalPnl`: `realizedPnl + unrealizedPnl`.

Dynamic pod governance:

- Research scouts continuously classify live Kalshi markets into pod themes.
- When a theme has enough market depth and approved paper opportunities, scouts propose or incubate a pod.
- If no proposal clears the threshold, the scout records a sleep-until time instead of pretending to work forever.
- Active pods defend analyst headcount with PnL, calibration, opportunities, and liquidity.
- Losing pods move to PIP or executive defense, reducing analyst count and requiring a defense memo before more risk budget.

Agent operating policy:

- Runtime agent prompts, decision rights, sector classification, pod lifecycle thresholds, analyst counts, scout sleep windows, proposal confidence, mandate actions, and CIO paper-cycle scoring are read from `config/agent-operating-policy.json`.
- Agents can read, propose, or apply permitted sections through CopilotKit tools and `GET/POST /api/agents/policy`.
- All policy proposals and applies require Redis auditability. If Redis is down, policy mutation is blocked.
- Protected safety surfaces are intentionally not agent-editable: live-trading environment flags, Kalshi/W&B/Copilot secrets, global kill switch state, permissions, and hard compliance prohibitions.
- The prior `Compliance Officer Agent` has been replaced by `Interim Compliance Officer Agent` in the executive roster. This is a personnel change only; compliance checks remain mandatory before every paper or live order.

## Key Endpoints

- `GET /api/integrations`
- `GET /api/markets`
- `GET /api/opportunities`
- `POST /api/agents/paper-cycle`
- `GET /api/agents/governance`
- `GET /api/agents/policy`
- `POST /api/agents/policy`
- `POST /api/trades/:id/approve`
- `POST /api/trades/:ticker/close`
- `POST /api/trades/:ticker/settle`
- `POST /api/trades/:id/execute`
- `GET /api/portfolio`
- `POST /api/portfolio/mark-to-market`
- `GET /api/audit`
- `POST /api/risk/live-trading-gate`
- `POST /api/memos/cio`
- `POST /api/copilotkit`

## Safety Notes

This software does not guarantee profits. Paper trades are simulations. Live trading is disabled by default and must never be enabled without credentials, Redis, configured limits, human approval, and operational monitoring.
