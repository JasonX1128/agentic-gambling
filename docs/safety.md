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
- Min liquidity.
- Min confidence.
- Positive expected value requirement.
- Capped fractional Kelly sizing.

Additional controls are represented in config and ready to extend:

- Max correlated exposure.
- Max slippage.
- Evidence quality.
- Rule ambiguity.
- Max drawdown.
