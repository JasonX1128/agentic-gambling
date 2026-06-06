import type {
  ActivityEvent,
  AgentNode,
  Market,
  Opportunity,
  PortfolioSnapshot,
  SectorPod
} from "@/lib/domain";
import { clamp, computeForecast, marketImpliedProbability } from "@/lib/quant/scoring";
import { evaluateCompliance } from "@/lib/compliance/engine";
import { evaluateRisk } from "@/lib/risk/engine";
import { getRiskLimits } from "@/lib/config/env";
import { hydrateAgentPolicy } from "@/lib/agents/policy";

const now = "2026-06-06T18:45:00.000Z";

export const demoMarkets: Market[] = [
  {
    id: "KXDEMO-FEDCUT-2026JUL",
    ticker: "KXDEMO-FEDCUT-2026JUL",
    eventTicker: "KXDEMO-FEDCUT",
    title: "Will the Federal Reserve cut rates at the July 2026 meeting?",
    category: "Economics",
    sector: "macro",
    status: "open",
    closeTime: "2026-07-29T18:00:00.000Z",
    yesBid: 38,
    yesAsk: 41,
    noBid: 58,
    noAsk: 62,
    lastPrice: 40,
    volume: 24500,
    openInterest: 8200,
    liquidity: 1800,
    ruleSummary: "Settles yes if the target range is lowered at the scheduled FOMC decision.",
    settlementSource: "Federal Reserve public announcement",
    source: "demo",
    updatedAt: now
  },
  {
    id: "KXDEMO-CPI-LOW-2026JUN",
    ticker: "KXDEMO-CPI-LOW-2026JUN",
    eventTicker: "KXDEMO-CPI",
    title: "Will June 2026 CPI year-over-year be below 2.8%?",
    category: "Economics",
    sector: "macro",
    status: "open",
    closeTime: "2026-07-15T12:30:00.000Z",
    yesBid: 51,
    yesAsk: 54,
    noBid: 45,
    noAsk: 49,
    lastPrice: 53,
    volume: 31100,
    openInterest: 10300,
    liquidity: 2200,
    ruleSummary: "Settles against the first BLS CPI release for June 2026.",
    settlementSource: "Bureau of Labor Statistics public release",
    source: "demo",
    updatedAt: now
  },
  {
    id: "KXDEMO-SENATE-BILL-2026",
    ticker: "KXDEMO-SENATE-BILL-2026",
    eventTicker: "KXDEMO-SENATE",
    title: "Will the Senate pass the energy permitting bill before August 2026?",
    category: "Politics",
    sector: "politics",
    status: "open",
    closeTime: "2026-08-01T03:59:00.000Z",
    yesBid: 27,
    yesAsk: 31,
    noBid: 68,
    noAsk: 73,
    lastPrice: 29,
    volume: 12700,
    openInterest: 5100,
    liquidity: 760,
    ruleSummary: "Settles yes if public congressional records show final Senate passage by the deadline.",
    settlementSource: "Congress.gov public roll-call and bill status",
    source: "demo",
    updatedAt: now
  },
  {
    id: "KXDEMO-HURRICANE-2026",
    ticker: "KXDEMO-HURRICANE-2026",
    eventTicker: "KXDEMO-WEATHER",
    title: "Will a named Atlantic hurricane make U.S. landfall before September 2026?",
    category: "Weather",
    sector: "climate",
    status: "open",
    closeTime: "2026-09-01T03:59:00.000Z",
    yesBid: 44,
    yesAsk: 48,
    noBid: 51,
    noAsk: 56,
    lastPrice: 46,
    volume: 9700,
    openInterest: 4100,
    liquidity: 590,
    ruleSummary: "Settles yes based on official NOAA/NHC storm and landfall records.",
    settlementSource: "NOAA and National Hurricane Center public records",
    source: "demo",
    updatedAt: now
  }
];

const baseAgentHierarchy: AgentNode[] = [
  {
    id: "cio",
    name: "CIO / Senior PM Agent",
    role: "Allocates capital across sector pods and approves trade recommendations.",
    status: "running",
    lastDecision: "Prioritize positive EV macro markets with sufficient liquidity."
  },
  {
    id: "cro",
    name: "Chief Risk Officer Agent",
    role: "Monitors drawdown, exposure, liquidity, and correlated events.",
    status: "running",
    lastDecision: "Politics exposure remains capped until evidence quality improves."
  },
  {
    id: "cco",
    name: "Compliance Officer Agent",
    role: "Blocks non-public information, unsupported claims, and ambiguous rules.",
    status: "running",
    lastDecision: "Requires public settlement-source citation for every thesis."
  },
  {
    id: "research-director",
    name: "Research Director Agent",
    role: "Searches for cross-sector conflicts and duplicated exposure.",
    status: "running",
    lastDecision: "Macro CPI and Fed-cut trades share inflation path exposure."
  },
  {
    id: "execution-supervisor",
    name: "Execution Supervisor Agent",
    role: "Routes approved orders to paper engine or gated live Kalshi adapter.",
    status: "idle",
    lastDecision: "Paper fills only until live prerequisites are complete."
  }
];

export const agentHierarchy: AgentNode[] = baseAgentHierarchy.map(hydrateAgentPolicy);

export function buildSectorPods(markets: Market[] = demoMarkets, opportunities?: Opportunity[]): SectorPod[] {
  const sectors = Array.from(new Set(markets.map((market) => market.sector)));
  return sectors.map((sector) => {
    const sectorMarkets = markets.filter((market) => market.sector === sector);
    const sectorOpportunities = opportunities?.filter((opportunity) => opportunity.sector === sector) ?? [];
    const blockedTrades = sectorOpportunities.length
      ? sectorOpportunities.filter((opportunity) => opportunity.status === "blocked").length
      : sector === "politics"
        ? 1
        : 0;
    const approvedCandidates = sectorOpportunities.length
      ? sectorOpportunities.filter((opportunity) => opportunity.status === "approved_for_paper" || opportunity.status === "paper_filled").length
      : Math.max(0, sectorMarkets.length - blockedTrades);
    const agents: AgentNode[] = [
      "Sector PM Agent",
      "Sector Risk Agent",
      "Data Analyst",
      "News Analyst",
      "Rules Analyst",
      "Market Microstructure Analyst",
      "Contrarian Agent",
      "Calibration Agent"
    ].map((role, index) =>
      hydrateAgentPolicy({
        id: `${sector}-${index}`,
        name: `${sector.toUpperCase()} ${role}`,
        role,
        status: index < 4 ? "running" : "idle",
        sector,
        lastDecision:
          role === "Contrarian Agent"
            ? "Stress test thesis against stale price and crowded narrative risk."
            : role === "Sector Risk Agent"
              ? "Negotiating paper-trade size against liquidity, spread, and calibration targets."
              : "Reviewing market rules, liquidity, and public evidence."
      })
    );
    return {
      id: `pod-${sector}`,
      sector,
      agents,
      activeMarkets: sectorMarkets.length,
      blockedTrades,
      approvedCandidates
    };
  });
}

export function buildDemoOpportunities(markets: Market[] = demoMarkets, portfolio?: PortfolioSnapshot): Opportunity[] {
  const limits = getRiskLimits();
  return markets.map((market, index) => {
    const fairProbability = estimateFairProbability(market, index);
    const evidence = [
      {
        id: `rules-${market.ticker}`,
        marketId: market.id,
        sourceType: "rules" as const,
        title: "Contract rule parse",
        excerpt: market.ruleSummary,
        credibilityScore: 0.82,
        capturedAt: now
      },
      {
        id: `book-${market.ticker}`,
        marketId: market.id,
        sourceType: "market_data" as const,
        title: "Order book snapshot",
        excerpt: `Yes ${market.yesBid}/${market.yesAsk}, liquidity score ${market.liquidity}.`,
        credibilityScore: 0.74,
        capturedAt: now
      }
    ];
    const forecast = computeForecast(market, fairProbability);
    const directionalEdge = Math.abs(forecast.expectedValue);
    const proposedSide = forecast.fairProbability >= forecast.marketProbability ? "yes" : "no";
    const thesis = {
      summary:
        directionalEdge > 0
          ? `Independent fair probability is ${forecast.expectedValue >= 0 ? "above" : "below"} market-implied probability by ${(directionalEdge * 100).toFixed(1)} points.`
          : "Watchlist candidate; edge is not yet strong enough for execution.",
      bullCase: [
        "Market-implied probability appears stale versus public data trend.",
        "Rules and settlement source are machine-readable enough for monitoring."
      ],
      bearCase: [
        "Thin order book may overstate executable edge.",
        "A single public release can invalidate the thesis quickly."
      ],
      invalidation: [
        "Rule interpretation changes or settlement source becomes disputed.",
        "Spread widens beyond risk limits before execution."
      ],
      evidence
    };
    const debate = [
      {
        agent: "Data Analyst",
        role: "Sector Analyst",
        stance: "support" as const,
        message: "Base-rate and current price imply a modest positive expected value.",
        scoreImpact: 0.08
      },
      {
        agent: "Rules Analyst",
        role: "Sector Analyst",
        stance: market.sector === "politics" ? ("oppose" as const) : ("support" as const),
        message:
          market.sector === "politics"
            ? "Settlement language has procedural edge cases; require smaller size."
            : "Settlement source is public and specific.",
        scoreImpact: market.sector === "politics" ? -0.14 : 0.05
      },
      {
        agent: "Contrarian Agent",
        role: "Contrarian",
        stance: "oppose" as const,
        message: "Do not size from EV alone; liquidity and hidden correlation should dominate sizing.",
        scoreImpact: -0.06
      },
      {
        agent: "Calibration Agent",
        role: "Calibration",
        stance: "neutral" as const,
        message: `Forecast bucket ${forecast.calibrationBucket}; use capped fractional Kelly only.`,
        scoreImpact: 0
      }
    ];
    const risk = evaluateRisk(
      {
        market,
        forecast,
        requestedNotional: Math.min(limits.riskAgentMaxPositionSize, Math.max(10, directionalEdge * 400)),
        portfolio
      },
      limits
    );
    const compliance = evaluateCompliance({ market, thesis, forecast });
    return {
      id: `opp-${market.ticker}`,
      market,
      side: proposedSide,
      rankScore: Math.round((directionalEdge * 100 + forecast.confidence * 25 + forecast.liquidityQuality * 20) * 10) / 10,
      forecast,
      thesis,
      debate: [...debate, ...risk.negotiation],
      risk,
      compliance,
      sector: market.sector,
      podId: `pod-${market.sector}`,
      status: risk.approved && compliance.approved ? "approved_for_paper" : "blocked",
      createdAt: now,
      traceId: `trace-demo-${index + 1}`
    };
  });
}

export function estimateFairProbability(market: Market, index = 0): number {
  if (market.source === "demo") {
    return [0.48, 0.60, 0.34, 0.50][index] ?? marketImpliedProbability(market);
  }
  const base = marketImpliedProbability(market);
  const hash = Array.from(market.ticker).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const researchTilt = ((hash % 13) - 6) / 100;
  const lastPriceTilt = market.lastPrice > 0 ? clamp(market.lastPrice / 100 - base, -0.03, 0.03) : 0;
  const liquidityDampener = market.liquidity < 100 ? 0.6 : market.liquidity < 500 ? 0.8 : 1;
  return clamp(base + (researchTilt + lastPriceTilt) * liquidityDampener, 0.02, 0.98);
}

export const demoPortfolio: PortfolioSnapshot = {
  mode: "paper",
  cash: 10000,
  availableCapital: 9650,
  netLiquidationValue: 10055,
  dailyPnl: 55,
  weeklyPnl: 55,
  realizedPnl: 0,
  unrealizedPnl: 55,
  openExposure: 350,
  sectorExposure: {
    macro: 250,
    politics: 0,
    climate: 100
  },
  positions: [
    {
      ticker: "KXDEMO-CPI-LOW-2026JUN",
      sector: "macro",
      yesContracts: 5,
      noContracts: 0,
      avgCost: 0.52,
      markPrice: 0.55,
      realizedPnl: 0,
      unrealizedPnl: 15,
      mode: "paper"
    },
    {
      ticker: "KXDEMO-HURRICANE-2026",
      sector: "climate",
      yesContracts: 2,
      noContracts: 0,
      avgCost: 0.45,
      markPrice: 0.47,
      realizedPnl: 0,
      unrealizedPnl: 4,
      mode: "paper"
    }
  ],
  orders: [],
  updatedAt: now
};

export const demoActivity: ActivityEvent[] = [
  {
    id: "evt-001",
    type: "system",
    actor: "CTO Build Agent",
    message: "EventFund OS initialized in paper mode; live trading remains gated.",
    severity: "success",
    createdAt: now
  },
  {
    id: "evt-002",
    type: "agent_decision",
    actor: "CIO / Senior PM Agent",
    message: "Ranked macro candidates ahead of politics due to higher liquidity and clearer settlement sources.",
    severity: "info",
    createdAt: now,
    traceId: "trace-demo-1"
  },
  {
    id: "evt-003",
    type: "blocked",
    actor: "Compliance Officer Agent",
    message: "Blocked one politics candidate pending lower rule ambiguity and public evidence score.",
    severity: "warning",
    createdAt: now,
    traceId: "trace-demo-3"
  }
];
