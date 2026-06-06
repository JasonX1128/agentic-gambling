# Architecture

EventFund OS uses typed modules inside a single Next.js application.

## Data Flow

1. Kalshi adapter fetches markets and order books using signed REST requests when credentials are present.
2. Market data is normalized into `Market`.
3. Sector pods classify markets and produce analyst debates.
4. Agent prompts, pod classification, lifecycle thresholds, analyst counts, scout cadence, and paper-cycle scoring are loaded from `config/agent-operating-policy.json`.
5. Quant scoring computes market probability, fair probability, EV, confidence, liquidity, downside, and calibration bucket.
6. Risk and compliance engines evaluate the opportunity.
7. CIO memo and opportunity tables expose recommendations.
8. The continuous paper daemon can enqueue research, risk, paper-cycle, reconciliation, learning, and executive-review tasks.
9. Redis Stream workers consume bounded batches and execute paper cycles, settlement reconciliation, policy learning, and executive committee review.
10. Execution supervisor sends paper orders to Redis-backed portfolio accounting by default.
11. Live orders are submitted to Kalshi only after live prerequisites and per-order approval pass.
12. Redis stores audit events, paper portfolio, idempotency keys, task streams, locks, ranked opportunities, and Pub/Sub events.
13. Weave traces meaningful lifecycle decisions when W&B credentials are present.
14. CopilotKit exposes safe actions for querying, explaining, filtering, memos, paper approval, daemon/worker control, live-gate requests, and permissioned operating-policy changes.

## Module Boundaries

- `lib/kalshi`: Venue adapter only.
- `lib/redis`: Coordination, idempotency, Pub/Sub, Streams, and state.
- `lib/observability`: Weave tracing and redaction.
- `lib/quant`: Probability, EV, sizing, calibration.
- `lib/risk`: Pre-trade, event-cluster exposure, and live-gate checks.
- `lib/compliance`: Public information and rule ambiguity policy checks.
- `lib/portfolio`: Paper portfolio accounting.
- `lib/execution`: Paper fills and gated live orders.
- `lib/agents`: Trading-agent swarm, sector pods, CIO synthesis, continuous daemon, Redis workers, reconciliation, learning loop, executive committee, and file-backed operating-policy ACL.
- `lib/security`: Production operator-token guard for mutating control routes.
- `config/agent-operating-policy.json`: Agent-editable strategy, prompt, governance, and paper-cycle policy. Safety gates and secrets remain outside agent write access.
- `components`: Operations UI.

## Redis Keys

- `efos:{env}:tasks:research`
- `efos:{env}:tasks:risk`
- `efos:{env}:tasks:cio-paper-cycle`
- `efos:{env}:tasks:postmortem`
- `efos:{env}:tasks:policy-learning`
- `efos:{env}:tasks:executive-review`
- `efos:{env}:events:market`
- `efos:{env}:events:risk`
- `efos:{env}:events:agent`
- `efos:{env}:portfolio:main`
- `efos:{env}:audit`
- `efos:{env}:opportunities:ranked`
- `efos:{env}:idempotency:*`
- `efos:{env}:lock:*`

Redis Stack memory keys are documented in the Redis agent plan and can be enabled when `JSON.SET` and `FT.CREATE` are available.
