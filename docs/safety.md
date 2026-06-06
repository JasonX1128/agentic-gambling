# Trading Modes And Safety

## Paper Mode

Paper mode is default. Paper orders never call Kalshi order placement. They require:

- Redis availability.
- Risk approval.
- Compliance approval.
- Idempotency key.
- Audit event.

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

Additional controls are represented in config and ready to extend:

- Max correlated exposure.
- Evidence quality.
- Rule ambiguity.
- Max drawdown.

The Risk Agent can negotiate inside hard limits, but it cannot waive true circuit breakers. Loss limits, full sector capacity exhaustion, open-order caps, impossible spreads beyond the configured circuit breaker, unusable liquidity, and very low confidence remain non-negotiable. Softer misses against Risk Agent targets, such as wider-than-desired spreads, thin-but-tradable liquidity, lower confidence, crowded sectors, or oversized analyst requests, produce a smaller counteroffer and required analyst actions instead of an automatic hard stop.

`POST /api/agents/paper-cycle` is the current volume path. It asks the CIO to rank eligible opportunities by directional edge, confidence, liquidity quality, risk score, negotiation cost, and sector crowding. It then routes only risk-approved and compliance-approved opportunities to the paper execution engine. The endpoint records the cycle in Redis Streams, saves ranked opportunities, emits audit events, and remains paper-only.
