import "server-only";

import type {
  AnalystDebateTurn,
  BrowserResearchReport,
  EvidenceItem,
  Market,
  Opportunity,
  SportsbookOddsComparison
} from "@/lib/domain";
import { getBrowserResearchConfig, getRiskLimits } from "@/lib/config/env";
import { computeForecast, marketImpliedProbability, clamp } from "@/lib/quant/scoring";
import { evaluateCompliance } from "@/lib/compliance/engine";
import { evaluateRisk } from "@/lib/risk/engine";
import { appendAuditEvent } from "@/lib/redis/coordination";
import { traceAsync } from "@/lib/observability/weave";

type BrowserHarnessResponse = {
  summary?: string;
  sources?: Array<{
    title?: string;
    url?: string;
    excerpt?: string;
    credibilityScore?: number;
  }>;
};

type OddsApiEvent = {
  id?: string;
  sport_key?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: Array<{
    key?: string;
    title?: string;
    last_update?: string;
    markets?: Array<{
      key?: string;
      outcomes?: Array<{
        name?: string;
        price?: number;
        point?: number;
      }>;
    }>;
  }>;
};

export async function researchOpportunityWithBrowserAgent(opportunity: Opportunity): Promise<Opportunity> {
  return traceAsync(
    "agent.browser_research",
    { opportunityId: opportunity.id, ticker: opportunity.market.ticker },
    async () => {
      const report = await buildBrowserResearchReport(opportunity);
      const enriched = attachBrowserResearchToOpportunity(opportunity, report);
      await appendAuditEvent({
        id: `audit-browser-research-${opportunity.market.ticker}-${Date.now()}`,
        type: "agent_decision",
        actor: "Browser Research Agent",
        message: `${report.status}: ${report.summary}`,
        severity: report.status === "blocked" ? "warning" : report.status === "partial" ? "info" : "success",
        createdAt: new Date().toISOString(),
        payload: {
          ticker: opportunity.market.ticker,
          blockers: report.blockers,
          sportsbookConsensusProbability: report.sportsbookConsensusProbability,
          sourceCount: report.sources.length,
          oddsCount: report.sportsbookComparisons.length
        }
      }).catch(() => undefined);
      return enriched;
    }
  );
}

export async function buildBrowserResearchReport(opportunity: Opportunity): Promise<BrowserResearchReport> {
  const config = getBrowserResearchConfig();
  const queries = buildBrowserResearchQueries(opportunity.market);
  const blockers: string[] = [];
  const harnessSources: EvidenceItem[] = [];
  let harnessSummary = "";

  if (config.enabled && config.endpoint) {
    try {
      const response = await fetchBrowserHarness({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
        market: opportunity.market,
        queries
      });
      harnessSummary = response.summary ?? "";
      harnessSources.push(...normalizeHarnessSources(opportunity.market, response));
    } catch (error) {
      blockers.push(`Browser harness failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    blockers.push(
      config.enabled
        ? "BROWSER_RESEARCH_ENDPOINT is not configured."
        : "BROWSER_RESEARCH_ENABLED is false."
    );
  }

  const oddsResult = await fetchSportsbookOdds(opportunity.market).catch((error) => ({
    comparisons: [] as SportsbookOddsComparison[],
    consensusProbability: undefined,
    blocker: `Sportsbook odds lookup failed: ${error instanceof Error ? error.message : String(error)}`
  }));
  if (oddsResult.blocker) blockers.push(oddsResult.blocker);
  const oddsSources = oddsResult.comparisons.length
    ? [sportsbookEvidence(opportunity.market, oddsResult.comparisons, oddsResult.consensusProbability)]
    : [];
  const sources = [...harnessSources, ...oddsSources];
  const status = sources.length && blockers.length ? "partial" : sources.length ? "complete" : "blocked";
  const kalshiMarketProbability = marketImpliedProbability(opportunity.market);
  const pricingNote = fairPricingNote(kalshiMarketProbability, oddsResult.consensusProbability);

  return {
    id: `browser-research-${opportunity.market.ticker}-${Date.now()}`,
    marketId: opportunity.market.id,
    ticker: opportunity.market.ticker,
    agentName: "Browser Research Agent",
    status,
    summary: summaryForReport(status, harnessSummary, sources, blockers, pricingNote),
    queries,
    sources,
    sportsbookComparisons: oddsResult.comparisons,
    sportsbookConsensusProbability: oddsResult.consensusProbability,
    kalshiMarketProbability,
    fairPricingNote: pricingNote,
    blockers,
    createdAt: new Date().toISOString()
  };
}

export function attachBrowserResearchToOpportunity(opportunity: Opportunity, report: BrowserResearchReport): Opportunity {
  const forecast = report.sportsbookConsensusProbability === undefined
    ? opportunity.forecast
    : computeForecast(
        opportunity.market,
        clamp(opportunity.forecast.fairProbability * 0.75 + report.sportsbookConsensusProbability * 0.25, 0.02, 0.98)
      );
  const side = forecast.fairProbability >= forecast.marketProbability ? "yes" : "no";
  const researchTurn = debateTurnForReport(report);
  const thesis = {
    ...opportunity.thesis,
    summary:
      report.status === "blocked"
        ? opportunity.thesis.summary
        : `${opportunity.thesis.summary} Browser research: ${report.fairPricingNote}`,
    bullCase: report.status === "blocked"
      ? opportunity.thesis.bullCase
      : [...opportunity.thesis.bullCase, "Browser Research Agent found public context or sportsbook pricing that can be compared against Kalshi."],
    bearCase: [
      ...opportunity.thesis.bearCase,
      ...(report.blockers.length ? [`Browser research incomplete: ${report.blockers[0]}`] : []),
      ...(report.sportsbookComparisons.length ? ["Sportsbook lines include vig and may not map exactly to the Kalshi contract rule."] : [])
    ],
    invalidation: [
      ...opportunity.thesis.invalidation,
      "Comparable sportsbook odds or public performance context moves materially against the thesis before execution."
    ],
    evidence: dedupeEvidence([...opportunity.thesis.evidence, ...report.sources])
  };
  const risk = evaluateRisk(
    {
      market: opportunity.market,
      forecast,
      requestedNotional: Math.min(getRiskLimits().riskAgentMaxPositionSize, Math.max(10, Math.abs(forecast.expectedValue) * 400))
    },
    getRiskLimits()
  );
  const compliance = evaluateCompliance({ market: opportunity.market, thesis, forecast });
  return {
    ...opportunity,
    side,
    forecast,
    thesis,
    debate: [...opportunity.debate, researchTurn, ...risk.negotiation],
    risk,
    compliance,
    browserResearch: report,
    rankScore: Number((opportunity.rankScore + researchScoreAdjustment(report)).toFixed(1)),
    status: risk.approved && compliance.approved ? "approved_for_paper" : "blocked"
  };
}

export function buildBrowserResearchQueries(market: Market): string[] {
  const cleanTitle = market.title.replace(/\s+/g, " ").trim();
  return [
    `${cleanTitle} latest public information`,
    `${cleanTitle} player performance stats injury news`,
    `${cleanTitle} sportsbook odds DraftKings FanDuel BetMGM`,
    `${market.ticker} Kalshi contract rules settlement source`
  ];
}

export function inferSportsbookSportKey(market: Pick<Market, "ticker" | "title" | "category" | "sector">): string | undefined {
  const text = `${market.ticker} ${market.title} ${market.category} ${market.sector}`.toLowerCase();
  if (/xmlb|mlb|baseball/.test(text)) return "baseball_mlb";
  if (/xnfl|nfl|football/.test(text)) return "americanfootball_nfl";
  if (/xnba|nba|basketball/.test(text)) return "basketball_nba";
  if (/xnhl|nhl|hockey/.test(text)) return "icehockey_nhl";
  if (/soccer|epl|mls|champions/.test(text)) return "soccer_epl";
  return undefined;
}

export function decimalOddsToImpliedProbability(decimalOdds: number): number {
  return decimalOdds > 1 ? Number((1 / decimalOdds).toFixed(4)) : 0;
}

async function fetchBrowserHarness(input: {
  endpoint: string;
  apiKey?: string;
  timeoutMs: number;
  market: Market;
  queries: string[];
}): Promise<BrowserHarnessResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {})
      },
      body: JSON.stringify({
        agent: "Browser Research Agent",
        task:
          "Use public web/browser sources only. Deep-dive the contract condition, player/team performance context, rule-relevant facts, and comparable sportsbook odds. Do not use private, leaked, confidential, or restricted-person information.",
        market: input.market,
        queries: input.queries
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
    }
    return (await response.json()) as BrowserHarnessResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSportsbookOdds(market: Market): Promise<{
  comparisons: SportsbookOddsComparison[];
  consensusProbability?: number;
  blocker?: string;
}> {
  const config = getBrowserResearchConfig();
  if (!config.oddsApiKey) {
    return {
      comparisons: [],
      blocker: "THE_ODDS_API_KEY is not configured for sportsbook comparison."
    };
  }
  const sportKey = inferSportsbookSportKey(market);
  if (!sportKey) {
    return {
      comparisons: [],
      blocker: "No sportsbook sport key could be inferred from the Kalshi market."
    };
  }
  const params = new URLSearchParams({
    apiKey: config.oddsApiKey,
    regions: config.oddsRegions,
    markets: config.oddsMarkets,
    oddsFormat: "decimal",
    dateFormat: "iso"
  });
  const response = await fetch(`${config.oddsApiBaseUrl}/v4/sports/${encodeURIComponent(sportKey)}/odds?${params}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    const text = await response.text();
    return {
      comparisons: [],
      blocker: `The Odds API ${sportKey} lookup returned HTTP ${response.status}: ${text.slice(0, 160)}`
    };
  }
  const events = (await response.json()) as OddsApiEvent[];
  const matched = bestOddsEventMatch(events, market);
  if (!matched) {
    return {
      comparisons: [],
      blocker: "No matching sportsbook event was found for this Kalshi market."
    };
  }
  const comparisons = extractSportsbookComparisons(matched).slice(0, 24);
  const consensusProbability = consensusProbabilityForMarket(market, comparisons);
  return { comparisons, consensusProbability };
}

function normalizeHarnessSources(market: Market, response: BrowserHarnessResponse): EvidenceItem[] {
  return (response.sources ?? [])
    .filter((source) => source.title || source.excerpt || source.url)
    .slice(0, 8)
    .map((source, index) => ({
      id: `browser-${market.ticker}-${index}`,
      marketId: market.id,
      sourceType: "browser_research" as const,
      title: source.title ?? "Browser research source",
      url: source.url,
      excerpt: (source.excerpt ?? "").slice(0, 500),
      credibilityScore: clamp(source.credibilityScore ?? 0.7, 0.2, 0.95),
      capturedAt: new Date().toISOString()
    }));
}

function sportsbookEvidence(
  market: Market,
  comparisons: SportsbookOddsComparison[],
  consensusProbability?: number
): EvidenceItem {
  const books = Array.from(new Set(comparisons.map((comparison) => comparison.sportsbook))).slice(0, 6);
  return {
    id: `sportsbook-${market.ticker}-${Date.now()}`,
    marketId: market.id,
    sourceType: "sportsbook_odds",
    title: "Comparable sportsbook odds",
    excerpt: `${comparisons.length} sportsbook outcome quotes across ${books.join(", ")}. ${
      consensusProbability === undefined ? "No reliable YES-side consensus mapping." : `Consensus implied YES probability ${(consensusProbability * 100).toFixed(1)}%.`
    }`,
    credibilityScore: consensusProbability === undefined ? 0.65 : 0.78,
    capturedAt: new Date().toISOString()
  };
}

function bestOddsEventMatch(events: OddsApiEvent[], market: Market): OddsApiEvent | undefined {
  const marketTokens = tokenSet(`${market.title} ${market.ticker}`);
  return events
    .map((event) => {
      const score = overlapScore(marketTokens, tokenSet(`${event.home_team ?? ""} ${event.away_team ?? ""}`));
      return { event, score };
    })
    .filter((item) => item.score >= 0.15)
    .sort((a, b) => b.score - a.score)[0]?.event;
}

function extractSportsbookComparisons(event: OddsApiEvent): SportsbookOddsComparison[] {
  return (event.bookmakers ?? []).flatMap((bookmaker) =>
    (bookmaker.markets ?? []).flatMap((market) =>
      (market.outcomes ?? [])
        .filter((outcome) => Number.isFinite(outcome.price) && (outcome.price ?? 0) > 1)
        .map((outcome) => ({
          sportsbook: bookmaker.title ?? bookmaker.key ?? "unknown",
          marketKey: market.key ?? "unknown",
          outcomeName: outcome.name ?? "unknown",
          decimalOdds: outcome.price ?? 0,
          impliedProbability: decimalOddsToImpliedProbability(outcome.price ?? 0),
          point: outcome.point,
          lastUpdate: bookmaker.last_update
        }))
    )
  );
}

function consensusProbabilityForMarket(market: Market, comparisons: SportsbookOddsComparison[]): number | undefined {
  const desired = desiredOutcomeNames(market);
  if (!desired.length) return undefined;
  const desiredTokens = desired.map(tokenSet);
  const matching = comparisons.filter((comparison) => {
    const outcomeTokens = tokenSet(comparison.outcomeName);
    return desiredTokens.some((tokens) => overlapScore(tokens, outcomeTokens) >= 0.5);
  });
  if (!matching.length) return undefined;
  const average = matching.reduce((sum, row) => sum + row.impliedProbability, 0) / matching.length;
  return Number(clamp(average, 0.02, 0.98).toFixed(4));
}

function desiredOutcomeNames(market: Market): string[] {
  const title = market.title.toLowerCase();
  const names: string[] = [];
  const willWin = market.title.match(/will\s+(.+?)\s+win/i);
  if (willWin?.[1]) names.push(willWin[1]);
  const winner = market.title.match(/^(.+?)\s+vs\.?\s+(.+?)\s+winner/i);
  if (winner?.[1]) names.push(winner[1]);
  if (title.includes("over")) names.push("over");
  if (title.includes("under")) names.push("under");
  if (title.includes("total")) names.push("over");
  return names.map((name) => name.replace(/[?]/g, "").trim()).filter(Boolean);
}

function fairPricingNote(kalshiProbability: number, sportsbookProbability?: number): string {
  if (sportsbookProbability === undefined) {
    return "No reliable sportsbook consensus mapping was available; rely on public-context evidence and Kalshi microstructure.";
  }
  const edge = sportsbookProbability - kalshiProbability;
  if (Math.abs(edge) < 0.03) {
    return `Sportsbook consensus ${(sportsbookProbability * 100).toFixed(1)}% is close to Kalshi ${(kalshiProbability * 100).toFixed(1)}%; pricing looks broadly fair.`;
  }
  return edge > 0
    ? `Sportsbook consensus ${(sportsbookProbability * 100).toFixed(1)}% is above Kalshi ${(kalshiProbability * 100).toFixed(1)}%; Kalshi YES may be underpriced if contract mapping is valid.`
    : `Sportsbook consensus ${(sportsbookProbability * 100).toFixed(1)}% is below Kalshi ${(kalshiProbability * 100).toFixed(1)}%; Kalshi YES may be overpriced if contract mapping is valid.`;
}

function summaryForReport(
  status: BrowserResearchReport["status"],
  harnessSummary: string,
  sources: EvidenceItem[],
  blockers: string[],
  pricingNote: string
): string {
  if (status === "blocked") return `Browser research blocked: ${blockers.join(" ")}`;
  const sourceSummary = sources.length ? `${sources.length} public/odds evidence items attached.` : "No evidence attached.";
  return [harnessSummary || sourceSummary, pricingNote].join(" ");
}

function debateTurnForReport(report: BrowserResearchReport): AnalystDebateTurn {
  const stance = report.status === "blocked"
    ? "neutral"
    : report.sportsbookConsensusProbability === undefined
      ? "neutral"
      : report.sportsbookConsensusProbability > report.kalshiMarketProbability
        ? "support"
        : "oppose";
  return {
    agent: "Browser Research Agent",
    role: "Public Web And Odds Research",
    stance,
    message: report.summary,
    scoreImpact: report.status === "blocked" ? -0.02 : stance === "support" ? 0.06 : stance === "oppose" ? -0.06 : 0.01
  };
}

function researchScoreAdjustment(report: BrowserResearchReport): number {
  if (report.status === "blocked") return -1;
  if (report.sportsbookConsensusProbability === undefined) return report.sources.length ? 1 : 0;
  return clamp((report.sportsbookConsensusProbability - report.kalshiMarketProbability) * 50, -4, 4);
}

function dedupeEvidence(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.sourceType}:${item.title}:${item.url ?? item.excerpt.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !["the", "and", "vs", "will", "win", "winner"].includes(token))
  );
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}
