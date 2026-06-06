# EventFund OS

EventFund OS is a demo-ready, human-supervised investment committee and paper-trading command center for Kalshi-style prediction markets. It emulates a hedge-fund workflow with specialist agents, but defaults to mock market data and simulated paper trades.

> Safety: this app is not financial advice, does not use insider/private information, and does not place real-money trades.

## What the demo does

A user enters a broad mandate such as:

```text
Find attractive Kalshi prediction market opportunities and build a risk-aware paper portfolio.
```

The app then runs an agent swarm that:

1. Scans mock Kalshi-like markets.
2. Interprets contract rules and settlement criteria.
3. Generates clearly marked public/simulated evidence.
4. Estimates implied probability, fair probability, edge, confidence, and risk.
5. Debates every thesis with specialist agents.
6. Applies risk and compliance checks.
7. Creates paper trades only.
8. Displays live traces, market table, portfolio, risk dashboard, and investment memo.
9. Offers a Copilot-style command sidebar for questions and filters.

## Agent architecture

- **CEO Agent**: demo focus and product clarity.
- **Product Agent**: UX workflow and prioritization.
- **Market Scanner Agent**: market discovery from mock Kalshi data.
- **Contract Interpreter Agent**: rules, expiration, settlement risk.
- **Research Agent**: public evidence or simulated fallback evidence.
- **Quant Analyst Agent**: implied/fair probability, edge, confidence.
- **Contrarian Agent**: challenges the trade thesis.
- **Risk Manager Agent**: exposure, liquidity, correlation, drawdown constraints.
- **Compliance Agent**: paper-only, no advice, no insider/manipulative assumptions.
- **Execution Agent**: creates paper positions only.
- **QA Agent**: verifies demo path.
- **Demo Agent**: memo and pitch narrative.

## Integrations and fallbacks

| Integration | Current behavior |
| --- | --- |
| Redis | Uses `REDIS_URL` if available; otherwise in-memory fallback with the same interface. Redis mode writes state to keys, events to streams, and publishes live updates. |
| Weave from W&B | If W&B/Weave credentials exist, the app marks tracing as configured-placeholder; otherwise local JSONL traces are written to `.eventfund-traces/agent-traces.jsonl`. |
| CopilotKit | Fallback command sidebar implements the intended UX without requiring CopilotKit setup. |
| Kalshi | Mock Kalshi-style markets are used by default and are clearly labeled. |

## Setup

```bash
npm install
npm run dev
```

Open the web app at <http://localhost:5173>. The API runs at <http://localhost:8787>.

## Environment variables

```bash
# Optional Redis coordination
REDIS_URL=redis://localhost:6379

# Optional W&B/Weave marker for tracing mode
WANDB_API_KEY=...
WEAVE_API_KEY=...

# Safety gate reserved for future live-trading code. The current UI remains paper-only.
ENABLE_LIVE_TRADING=false

# Optional frontend API override
VITE_API_URL=http://localhost:8787
```

## Demo script

1. Start the app with `npm run dev` and open <http://localhost:5173>.
2. Point out the safety banner: paper trading only, human CIO supervision, not financial advice.
3. Click **Run investment committee** with the default mandate.
4. Watch the agent swarm timeline populate with scanner, quant, contrarian, risk, compliance, execution, QA, and demo traces.
5. Select a market in the table and explain contract interpretation, simulated evidence, fair-value estimate, debate, risk notes, and compliance notes.
6. Show the paper portfolio and risk dashboard.
7. Use the command sidebar:
   - “Why did the agents recommend this market?”
   - “Show only low-risk trades.”
   - “Reduce exposure to politics markets.”
   - “Generate the investment memo.”
8. Close with the memo: EventFund OS turns a broad mandate into an observable, risk-aware, paper-trading investment committee workflow.

## Pitch summary

Prediction markets are information-dense but operationally hard to evaluate safely. EventFund OS provides a supervised, observable analyst swarm that transforms a high-level mandate into traceable market interpretation, quantified edge, adversarial debate, risk controls, compliance checks, and paper trades. The product is designed to be demo-reliable without live credentials and ready to extend to real Kalshi data under strict human approval and safety gates.

## Testing

```bash
npm test
npm run smoke
npm run build
```

## Assumptions

- Kalshi credentials may be unavailable, so the demo uses realistic mock markets.
- Outputs are educational/demo artifacts for a human CIO, not financial advice.
- No live order placement is implemented in this version.
