# Trading Modes And Safety

## Paper Mode

Paper mode is default. Paper orders never call Kalshi order placement. They require:

- Redis availability.
- Risk approval.
- Compliance approval.
- Idempotency key.
- Audit event.

Paper fills immediately mutate the Redis-backed paper portfolio. They are simulated orders, not staged recommendations.

## Live Mode

Live mode requires:

- `TRADING_MODE=live`
- `ENABLE_LIVE_TRADING=true`
- `KALSHI_API_KEY`
- `KALSHI_PRIVATE_KEY` or `KALSHI_PRIVATE_KEY_PATH`
- `MAX_DAILY_LOSS`
- `MAX_POSITION_SIZE`
- `MAX_SECTOR_EXPOSURE`
- `GLOBAL_KILL_SWITCH=false`

Per order, the execution route also requires:

- Approval token `approve:<opportunityId>`.
- Redis idempotency.
- Risk pass.
- Compliance pass.
- Kalshi signed order submission.

CopilotKit can request live-gate changes, but it cannot directly switch the server into live mode. Environment variables and server checks decide the effective mode.

## Agent-Editable Policy Boundaries

The dynamic operating policy lives in `config/agent-operating-policy.json`. Agents can tune prompts, decision rights, sector classification, pod lifecycle thresholds, analyst headcount, scout sleep cadence, proposal scoring, mandate actions, and CIO paper-cycle scoring through `GET/POST /api/agents/policy` or CopilotKit tools.

Policy mutation has permission levels:

- Most trading agents can read and propose policy changes.
- CIO, Research Director, CRO, Executive Review, and Calibration roles can apply only the sections they are allowed to own.
- Policy writes require Redis auditability; if Redis is down, the write is blocked.
- Agents cannot edit live-trading environment flags, Kalshi/W&B/Copilot secrets, global kill switch state, permissions, or hard compliance prohibitions.

## Compliance Blocks

The Compliance Officer blocks trades involving:

- Material non-public information.
- Leaked, private, confidential, or improperly obtained sources.
- Manipulation, spoofing, or deceptive intent.
- Restricted-person assumptions.
- Missing public settlement source.
- Rule ambiguity beyond threshold.
- Unsupported high-confidence claims.

## Risk Controls

Implemented controls include:

- Max position size.
- Max sector exposure.
- Daily and weekly loss checks.
- Max open orders.
- Max slippage.
- Min liquidity.
- Min confidence.
- Positive expected value requirement.
- Capped fractional Kelly sizing.
- Risk-agent negotiation for lower size, tighter entry, more liquidity, or more evidence.
- Agent paper-cycle slate selection that respects risk/compliance approval before execution.
- Opposite-position hard block until the existing paper position is closed or settled.

Additional controls are represented in config and ready to extend:

- Max correlated exposure.
- Evidence quality.
- Rule ambiguity.
- Max drawdown.

The Risk Agent can negotiate inside hard limits, but it cannot waive true circuit breakers. Loss limits, full sector capacity exhaustion, open-order caps, impossible spreads beyond the configured circuit breaker, unusable liquidity, and very low confidence remain non-negotiable. Softer misses against Risk Agent targets, such as wider-than-desired spreads, thin-but-tradable liquidity, lower confidence, crowded sectors, or oversized analyst requests, produce a smaller counteroffer and required analyst actions instead of an automatic hard stop.

`POST /api/agents/paper-cycle` is the current volume path. It asks the CIO to rank eligible opportunities by directional edge, confidence, liquidity quality, risk score, negotiation cost, and sector crowding. It then routes only risk-approved and compliance-approved opportunities to the paper execution engine. The endpoint records the cycle in Redis Streams, saves ranked opportunities, emits audit events, and remains paper-only.

## Dynamic Pod Governance

`GET /api/agents/governance` recomputes the fund operating model from current Kalshi markets, paper opportunities, portfolio PnL, settlements, and open exposure.

- Research scouts investigate live market clusters and create pod proposals only when the theme has enough market depth or approved paper candidates.
- Scouts with no proposal enter a sleeping state with a wake time.
- Pods dynamically change analyst count based on lifecycle state and opportunity load.
- Active pods must defend their mandate with PnL, calibration, and a falsifiable public-information edge.
- Pods with losses or weak mandate scores are moved to PIP or executive defense. Defense requires PnL attribution, thesis failure analysis, prompt/sizing changes, and next probe budget.
- PIP/defense does not bypass risk or compliance; it restricts the pod's mandate and analyst allocation.

## Paper Accounting

Paper accounting separates:

- `unrealizedPnl`: open mark-to-market PnL, refreshed from Kalshi market data by `POST /api/portfolio/mark-to-market`.
- `closedPnl`: realized PnL from explicit paper closes.
- `settledPnl`: realized PnL from paper settlement outcomes.
- `realizedPnl`: closed plus settled PnL.
- `totalPnl`: realized plus unrealized PnL.

Settlements record outcome, settlement price, realized PnL, forecast probability, Brier score, and calibration bucket. They also emit a postmortem audit event. Settlement is manual in paper mode because the app does not yet run a scheduled Kalshi settlement reconciliation worker.
