# Build-Agent Execution Plan

The CTO agent split the work across specialist build agents before implementation.

## Planning Cohort

- Product Strategy Agent defined the command center journey, paper/live behavior, and acceptance criteria.
- UX/Product Design Agent specified a dense trading operations interface with top-level mode and kill-switch controls.
- System Architect Agent defined service boundaries for Kalshi, Redis, Weave, CopilotKit, agents, risk, compliance, execution, and portfolio.
- Redis Infrastructure Agent defined Streams, Pub/Sub, hashes, sorted sets, locks, idempotency keys, and Redis Stack checks.
- Weave Observability Engineer Agent defined trace/eval schema, `weave.init`, `weave.op`, Brier/calibration, and missing-credential behavior.
- CopilotKit Integration Agent defined runtime route, provider, readable state, and required actions.
- Engineering Lead Agent converted the plan into implementation files and dependency cautions.
- QA/Test Agent defined smoke tests and failure-mode gates.

## Automation Cohort

- Backend Engineer added the locked paper daemon, bounded route handlers, and production operator-token guard.
- Redis Infrastructure Agent added consumer-group reads and acknowledgements for fund worker queues.
- Agent Orchestration Engineer added worker handlers for paper cycles, reconciliation, policy learning, and executive review.
- Data/Quant Engineer added event-cluster exposure detection for duplicated Kalshi risk.
- Research/Odds Agent added the Browser Research Agent, public browser-harness adapter, sportsbook odds comparison, and pre-execution enrichment.
- QA/Test Agent added risk-cluster and settlement-inference coverage plus smoke checks for daemon/worker surfaces.
- Documentation Agent updated runbooks for continuous paper trading, learning proposals, reconciliation, and production access control.

## CTO Resolutions

- Use one compact Next.js app instead of a monorepo because the repo was empty and the MVP should run locally.
- Keep mandatory integrations real, but mark them blocked when credentials or services are missing.
- Do not provide an in-memory replacement for Redis execution state. Read-only demo data is allowed for UI inspection; trading actions require Redis.
- Default to paper mode. Live mode is a server-side gate, not a UI toggle.
- Treat CopilotKit as a control plane with schema-bound actions, not as an unrestricted chatbot.

## Implementation Ownership

- Backend Engineer: `lib/kalshi`, `lib/execution`, API routes.
- Data/Quant Engineer: `lib/quant`, forecast and sizing calculations.
- Agent Orchestration Engineer: `lib/agents`, sector pods, debates, CIO memo.
- Redis Infrastructure Agent: `lib/redis`, idempotency, audit, Pub/Sub, Streams.
- Runtime/Workers Agent: `lib/agents/daemon.ts`, `lib/agents/workers.ts`, `scripts/paper-daemon.mjs`.
- Research/Odds Agent: `lib/research/browser-agent.ts`, `app/api/research/browser/[id]`.
- Weave Observability Agent: `lib/observability`.
- CopilotKit Agent: `app/api/copilotkit`, `components/copilot`.
- Frontend/UX: `components/CommandCenter.tsx`.
- QA: `tests`, `scripts/smoke-test.mjs`.
- Documentation: README and `docs/*`.
