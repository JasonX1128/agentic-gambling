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
- Weave Observability Agent: `lib/observability`.
- CopilotKit Agent: `app/api/copilotkit`, `components/copilot`.
- Frontend/UX: `components/CommandCenter.tsx`.
- QA: `tests`, `scripts/smoke-test.mjs`.
- Documentation: README and `docs/*`.
