# Integration Status

Status depends on local credentials and services. The code paths are implemented, but runtime availability may be blocked.

## Kalshi

Implemented:

- Signed REST requests using `timestamp + METHOD + path`.
- RSA-PSS/SHA256 signing.
- Market list, market details, order book, balance, positions, orders, create order, cancel order wrappers.
- Live order path calls Kalshi only after explicit live gates pass.

Blocked until:

- `KALSHI_API_KEY`
- `KALSHI_PRIVATE_KEY` or `KALSHI_PRIVATE_KEY_PATH`
- Valid `KALSHI_BASE_URL`

## Redis

Implemented:

- Required client and health checks.
- Streams via `xAdd`.
- Stream consumer groups via `xGroupCreate`, `xReadGroup`, and `xAck`.
- Pub/Sub via `publish`.
- Audit list.
- Portfolio state.
- Idempotency keys.
- Locks with compare-and-delete Lua release.
- Ranked opportunity sorted set.
- Continuous daemon locks and worker queues for research, risk, paper-cycle, postmortem/reconciliation, policy learning, and executive review.

Blocked until Redis is running:

```bash
docker run --name efos-redis-stack -p 6379:6379 -p 8001:8001 redis/redis-stack:latest
```

## Weave

Implemented:

- `weave.init`.
- `weave.op` lifecycle wrapper.
- Secret redaction.
- Trace IDs on trading lifecycle results.
- Brier and calibration helpers.

Blocked until:

- `WANDB_API_KEY`
- `WEAVE_PROJECT` or `WANDB_PROJECT`
- Optional `WANDB_ENTITY`

Missing Weave credentials do not block paper-mode analysis, but tracing is reported as blocked.

## CopilotKit

Implemented:

- Runtime route at `/api/copilotkit`.
- Provider and sidebar.
- Readable compressed app state.
- Actions for trade queries, recommendation explanations, risk-limit requests, opportunity filtering, CIO memos, paper trade approval, daemon ticks, Redis worker runs, learning proposals, reconciliation, executive review, and live-gate requests.
- Action for running Browser Research Agent on a recommendation before approval.

Free local setup:

- `LLM_PROVIDER=ollama`
- `OLLAMA_BASE_URL=http://localhost:11434/v1`
- `OLLAMA_MODEL=qwen2.5:3b`
- `ollama pull qwen2.5:3b`
- `ollama serve`

Optional paid fallback:

- `LLM_PROVIDER=openai`
- `OPENAI_API_KEY` set for OpenAI-backed chat responses.

CopilotKit cannot bypass risk, compliance, Redis, or live-trading gates.

Set `COPILOTKIT_TELEMETRY_DISABLED=true` to opt out of CopilotKit anonymous telemetry during local builds/runs.

## Browser Research And Sportsbook Odds

Implemented:

- `Browser Research Agent` role in the sector pod roster.
- `POST /api/research/browser/:id` to attach public web/odds evidence to an opportunity.
- Pre-execution research pass in paper and live order paths.
- Generic `BROWSER_RESEARCH_ENDPOINT` adapter for a browser harness service.
- The Odds API adapter for sportsbook odds snapshots using `/v4/sports/{sport}/odds`.

Blocked until configured:

- `BROWSER_RESEARCH_ENABLED=true`
- `BROWSER_RESEARCH_ENDPOINT` for public web deep dives
- `THE_ODDS_API_KEY` for sportsbook odds comparison

Missing browser/odds credentials do not fake research. The agent records blockers and the trade continues only through the normal Kalshi, risk, compliance, Redis, and live-gate rules.

## Dependency Audit

Verified with `npm audit --omit=dev` after upgrading Next to `16.2.7` and applying safe updates/overrides for direct PostCSS, PrismJS, and uuid.

Remaining production audit items:

- `@ai-sdk/provider-utils` through `@copilotkit/runtime@1.59.5` and its Google Vertex/OpenAI-compatible dependencies. npm marks this low/moderate chain and suggests `npm audit fix --force`, but that would downgrade CopilotKit to `1.54.1`, a breaking change for the mandatory CopilotKit integration.
- `postcss <8.5.10` nested under `next@16.2.7`. The direct `postcss` dependency is patched to `8.5.15`, but Next still vendors `8.4.31`; npm's suggested force fix is a breaking downgrade to `next@9.3.3`.

Current CTO decision: do not force breaking downgrades. Track upstream CopilotKit/Next releases and update when patched versions are available.
