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
- Quant scoring: market-implied probability, fair probability, EV, confidence, liquidity quality, capped Kelly sizing, Brier/calibration helpers.
- Paper trading engine that updates Redis-backed portfolio state.
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
MAX_DAILY_LOSS=500
MAX_POSITION_SIZE=100
MAX_SECTOR_EXPOSURE=250
GLOBAL_KILL_SWITCH=false
```

Every live order still requires an explicit approval token, Redis idempotency, risk approval, compliance approval, and Kalshi credentials.

## Key Endpoints

- `GET /api/integrations`
- `GET /api/markets`
- `GET /api/opportunities`
- `POST /api/trades/:id/approve`
- `POST /api/trades/:id/execute`
- `GET /api/portfolio`
- `GET /api/audit`
- `POST /api/risk/live-trading-gate`
- `POST /api/memos/cio`
- `POST /api/copilotkit`

## Safety Notes

This software does not guarantee profits. Paper trades are simulations. Live trading is disabled by default and must never be enabled without credentials, Redis, configured limits, human approval, and operational monitoring.
