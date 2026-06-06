# Architecture

EventFund OS uses typed modules inside a single Next.js application.

## Data Flow

1. Kalshi adapter fetches markets and order books using signed REST requests when credentials are present.
2. Market data is normalized into `Market`.
3. Sector pods classify markets and produce analyst debates.
4. Quant scoring computes market probability, fair probability, EV, confidence, liquidity, downside, and calibration bucket.
5. Risk and compliance engines evaluate the opportunity.
6. CIO memo and opportunity tables expose recommendations.
7. Execution supervisor sends paper orders to Redis-backed portfolio accounting by default.
8. Live orders are submitted to Kalshi only after live prerequisites and per-order approval pass.
9. Redis stores audit events, paper portfolio, idempotency keys, task streams, and Pub/Sub events.
10. Weave traces meaningful lifecycle decisions when W&B credentials are present.
11. CopilotKit exposes safe actions for querying, explaining, filtering, memos, paper approval, and live-gate requests.

## Module Boundaries

- `lib/kalshi`: Venue adapter only.
- `lib/redis`: Coordination, idempotency, Pub/Sub, Streams, and state.
- `lib/observability`: Weave tracing and redaction.
- `lib/quant`: Probability, EV, sizing, calibration.
- `lib/risk`: Pre-trade and live-gate checks.
- `lib/compliance`: Public information and rule ambiguity policy checks.
- `lib/portfolio`: Paper portfolio accounting.
- `lib/execution`: Paper fills and gated live orders.
- `lib/agents`: Trading-agent swarm, sector pods, CIO synthesis.
- `components`: Operations UI.

## Redis Keys

- `efos:{env}:tasks:research`
- `efos:{env}:tasks:risk`
- `efos:{env}:tasks:execution`
- `efos:{env}:events:market`
- `efos:{env}:events:risk`
- `efos:{env}:events:agent`
- `efos:{env}:portfolio:main`
- `efos:{env}:audit`
- `efos:{env}:opportunities:ranked`
- `efos:{env}:idempotency:*`
- `efos:{env}:lock:*`

Redis Stack memory keys are documented in the Redis agent plan and can be enabled when `JSON.SET` and `FT.CREATE` are available.
