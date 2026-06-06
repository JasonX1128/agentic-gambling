# Cloud Deployment

EventFund OS should move to cloud as a containerized service, not a purely serverless app. The product is heading toward continuous agent workers, Redis Stream consumers, paper-trading daemons, and settlement reconciliation, so the runtime needs stable processes, managed Redis, and explicit health checks.

## Recommended First Target

Use Railway, Render, Fly, or AWS ECS with the included `Dockerfile`. Railway is the fastest first move because it can deploy this Dockerfile and attach a managed Redis service quickly. The app is not Railway-specific; the same image can run anywhere that supports Docker.

## What Was Added

- `Dockerfile`: builds a Next.js standalone production image.
- `railway.toml`: Railway Docker deployment and `/api/health` health check.
- `/api/health`: liveness plus mandatory integration readiness.
- `.env.cloud.example`: production paper-trading environment template.
- `npm run cloud:preflight`: checks cloud env readiness before launch.

The Next.js standalone output is controlled by `EVENTFUND_DEPLOY_TARGET=cloud`. Local development and local builds omit that flag and use normal Next output.

## Required Cloud Services

- App container running EventFund OS.
- Managed Redis or Redis Stack exposed through `REDIS_URL`.
- Kalshi API credentials for authenticated API paths.
- W&B Weave credentials.
- CopilotKit model backend:
  - Free path: run an Ollama service reachable from the app and set `OLLAMA_BASE_URL`.
  - Paid/simple path: set `LLM_PROVIDER=openai` and `OPENAI_API_KEY`.

The free Ollama path is possible in cloud, but it is not the same as local laptop Ollama. The app container must be able to reach a separate Ollama service URL, for example a private service in the same cloud project. `localhost` will not work unless Ollama runs in the same container, which is not recommended for this app.

## First Cloud Launch

1. Create the cloud app from this repository.
2. Use Dockerfile-based deployment.
3. Attach managed Redis and set `REDIS_URL`.
4. Add all variables from `.env.cloud.example`.
5. Keep:
   - `EVENTFUND_DEPLOY_TARGET=cloud`
   - `TRADING_MODE=paper`
   - `ENABLE_LIVE_TRADING=false`
   - `GLOBAL_KILL_SWITCH=false`
   - `ALLOW_DEMO_MARKETS=false`
6. Run:

```bash
npm run cloud:preflight
```

For local verification without the cloud target:

```bash
npm run dev
npm run build:local
```

7. Deploy.
8. Check:

```bash
curl https://YOUR_APP_URL/api/health
curl https://YOUR_APP_URL/api/integrations
curl https://YOUR_APP_URL/api/agents/policy
```

## Current Blockers Before I Can Deploy It For You

I cannot complete the actual cloud deployment from this local workspace without:

- Cloud provider account/project access.
- Managed Redis connection string.
- Kalshi API key and private key in the cloud secret store.
- W&B API key and project/entity values in the cloud secret store.
- A reachable cloud model backend for CopilotKit. For the free-model path, that means an Ollama service URL reachable from the app.

These are credential/account blockers only. The code path for cloud deployment is now present.

## Health Semantics

`GET /api/health` returns:

- `liveness: ok` when the process is running.
- `readiness: ready` only when mandatory integrations are not blocked.
- `readiness: blocked` with a `503` response when Redis, Kalshi, Weave, or CopilotKit is blocked.

This is intentionally strict so the cloud platform does not treat a half-configured trading system as healthy.

## Live Trading

Do not enable live mode in the first cloud deployment. Live trading still requires every existing hard gate:

- `TRADING_MODE=live`
- `ENABLE_LIVE_TRADING=true`
- Kalshi credentials
- configured risk limits
- `GLOBAL_KILL_SWITCH=false`
- per-order approval token
- Redis idempotency
- risk approval
- compliance approval
