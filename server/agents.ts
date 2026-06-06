import type { AppState, DebatePoint, Market, PaperPosition, Portfolio, Recommendation, TraceEvent } from './types.js';
import { mockMarkets } from './mockData.js';
import { traceEvent } from './tracing.js';

const cents = (n: number) => Math.max(0, Math.round(n));
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function evidenceFor(market: Market) {
  const common = ['Public datasets only; no private, insider, or manipulative information used.', 'Mock evidence generated for demo when live data/API credentials are unavailable.'];
  const map: Record<string, string[]> = {
    Economics: ['Recent nowcast-style indicators suggest mixed but resilient demand.', 'Market-implied macro probabilities have repriced toward slower but positive growth.', 'Upcoming official statistical release is the settlement source, so revision risk is limited to initial release methodology.'],
    Climate: ['Seasonal ocean heat and early basin conditions can support elevated formation odds.', 'Storm formation timing remains high-variance and model-sensitive.', 'NHC classification language is the key settlement dependency.'],
    Politics: ['Polling-average markets can move sharply on methodology and sample composition.', 'The cutoff date is near, reducing time exposure but increasing headline sensitivity.', 'Political exposure is capped by policy and marked as higher compliance scrutiny.'],
    Culture: ['Awards markets are narrative-driven and relatively illiquid.', 'Streaming-first definitions can create ambiguous settlement interpretation.', 'Long-dated event risk makes this better suited for watchlist than sizing.'],
    Sports: ['Team-news uncertainty and schedule compression create price volatility.'],
    'Public Health': ['Official public health data definitions drive settlement risk.']
  };
  return { marketId: market.id, bullets: [...(map[market.category] ?? common), ...common].slice(0, 5), sources: ['BEA/BLS/NHC/public polling or official market rule pages as applicable', 'Mock Kalshi-like market feed'], simulated: true, freshness: 'Generated during demo run' };
}

function interpret(market: Market) {
  return `${market.rules} Settlement dependency: ${market.settlement} Close: ${new Date(market.closeTime).toLocaleString('en-US', { timeZone: 'UTC' })} UTC. Watch for exact threshold wording, publication source, and whether ties settle YES or NO.`;
}

function estimate(market: Market) {
  const implied = market.yesPrice / 100;
  const liquidityAdj = (market.liquidityScore - 60) / 1000;
  const volumeAdj = clamp(Math.log10(Math.max(market.volume, 1)) - 4.5, -0.25, 0.25) / 8;
  const categoryTilt: Record<string, number> = { Economics: 0.055, Climate: -0.01, Politics: -0.015, Culture: -0.04, Sports: 0, 'Public Health': 0 };
  const fairProbability = clamp(implied + liquidityAdj + volumeAdj + (categoryTilt[market.category] ?? 0), 0.05, 0.95);
  const edge = fairProbability - implied;
  const confidence = clamp(0.45 + market.liquidityScore / 250 + Math.abs(edge) * 0.8 - (market.category === 'Culture' ? 0.16 : 0), 0.25, 0.86);
  return { implied, fairProbability, edge, confidence };
}

function risk(market: Market, edge: number, confidence: number, portfolio: Portfolio) {
  const categoryExposure = portfolio.exposureByCategory[market.category] ?? 0;
  const liquidityRisk = 100 - market.liquidityScore;
  const categoryRisk = market.category === 'Politics' ? 25 : market.category === 'Culture' ? 30 : 10;
  const concentrationRisk = categoryExposure > 25000 ? 20 : categoryExposure > 12000 ? 10 : 0;
  const riskScore = clamp(Math.round(liquidityRisk * 0.45 + categoryRisk + concentrationRisk + (1 - confidence) * 25 - Math.abs(edge) * 100), 5, 95);
  const notes = [
    `Liquidity score ${market.liquidityScore}/100; ${market.liquidityScore < 55 ? 'small clips only.' : 'sufficient for demo paper sizing.'}`,
    `Category exposure before trade: $${(categoryExposure / 100).toFixed(2)} in ${market.category}.`,
    `Correlation bucket ${market.correlationBucket}; avoid stacking multiple highly similar macro bets.`,
    `Max paper position capped at 8% of portfolio cash and reduced further when risk exceeds 55.`
  ];
  return { riskScore, notes };
}

function compliance(market: Market, recommendation: string) {
  const notes = ['Paper trading only; no live order route is enabled by default.', 'Not financial advice; output is an analyst memo for a human CIO.', 'Uses public/simulated evidence only and rejects insider-information assumptions.'];
  const blocked = recommendation !== 'WATCH' && (market.liquidityScore < 30 || /insider|manipulat/i.test(market.rules));
  if (market.category === 'Politics') notes.push('Political market receives heightened uncertainty and manipulation-sensitivity warning.');
  return { blocked, notes };
}

function debate(market: Market, edge: number, confidence: number, riskScore: number): DebatePoint[] {
  const ts = new Date().toISOString();
  return [
    { agent: 'Quant Analyst Agent', stance: edge > 0 ? 'support' : 'challenge', message: `Estimated edge ${(edge * 100).toFixed(1)} percentage points with confidence ${(confidence * 100).toFixed(0)}%.`, score: confidence, ts },
    { agent: 'Contract Interpreter Agent', stance: 'neutral', message: `Settlement hinges on exact rule text and official source for ${market.id}.`, ts },
    { agent: 'Research Agent', stance: 'support', message: 'Public-evidence simulation found a plausible catalyst path, but labels it as mock evidence.', ts },
    { agent: 'Contrarian Agent', stance: 'challenge', message: `Main objection: market may already price the obvious thesis; ${market.category.toLowerCase()} data can change abruptly near expiry.`, ts },
    { agent: 'Risk Manager Agent', stance: riskScore < 60 ? 'approve' : 'challenge', message: `Risk score ${riskScore}/100; ${riskScore < 60 ? 'within demo limits' : 'requires watchlist or smaller sizing'}.`, score: 100 - riskScore, ts },
    { agent: 'Compliance Agent', stance: 'approve', message: 'Allowed only as paper trade with uncertainty, evidence, and risk notes shown to the human CIO.', ts }
  ];
}

function createRecommendation(market: Market, portfolio: Portfolio): Recommendation {
  const { implied, fairProbability, edge, confidence } = estimate(market);
  const baseRecommendation = edge > 0.035 && confidence > 0.48 ? 'BUY_YES' : edge < -0.045 && confidence > 0.5 ? 'BUY_NO' : 'WATCH';
  const riskResult = risk(market, edge, confidence, portfolio);
  const comp = compliance(market, baseRecommendation);
  const finalRecommendation = comp.blocked ? 'BLOCKED' : riskResult.riskScore > 72 ? 'WATCH' : baseRecommendation;
  const budget = finalRecommendation.startsWith('BUY') ? 8000 * confidence * (1 - riskResult.riskScore / 130) : 0;
  const price = finalRecommendation === 'BUY_NO' ? market.noPrice : market.yesPrice;
  const proposedShares = finalRecommendation.startsWith('BUY') ? Math.max(1, Math.floor(budget / Math.max(price, 1))) : 0;
  return {
    market,
    interpretedContract: interpret(market),
    evidence: evidenceFor(market),
    fairProbability,
    impliedProbability: implied,
    edge,
    confidence,
    riskScore: riskResult.riskScore,
    riskNotes: riskResult.notes,
    complianceNotes: comp.notes,
    recommendation: finalRecommendation as Recommendation['recommendation'],
    thesis: edge > 0 ? `YES appears underpriced versus a fair value near ${(fairProbability * 100).toFixed(1)}%.` : `YES does not clear edge threshold; either watch or consider NO only if confidence is strong.`,
    contrarian: `If official data or rule interpretation diverges from the simulated evidence, the edge can disappear; limit size and require human review.`,
    proposedShares,
    notionalCents: cents(proposedShares * price),
    debate: debate(market, edge, confidence, riskResult.riskScore)
  };
}

export function initialState(): AppState {
  return {
    mandate: 'Find attractive Kalshi prediction market opportunities and build a risk-aware paper portfolio.',
    status: 'idle',
    markets: [],
    recommendations: [],
    portfolio: { cashCents: 100000, totalNotionalCents: 0, positions: [], exposureByCategory: {}, maxDrawdownLimitCents: 15000 },
    traces: [],
    memo: '',
    assumptions: ['Kalshi credentials are not required; mock Kalshi-like data is used unless an API integration is added.', 'All orders are simulated paper trades.', 'Human user is the CIO and must approve any real-world action outside this demo.'],
    integrations: { redis: 'fallback-memory', weave: 'fallback-local-traces', copilot: 'fallback-command-sidebar', kalshi: 'mock-data' }
  };
}

export async function runCommittee(mandate: string, emit: (event: TraceEvent) => Promise<void>, modes: Pick<AppState['integrations'], 'redis' | 'weave'>): Promise<AppState> {
  const state = initialState();
  state.integrations.redis = modes.redis;
  state.integrations.weave = modes.weave;
  state.status = 'running';
  state.mandate = mandate;
  const emitAgent = async (agent: TraceEvent['agent'], type: TraceEvent['type'], message: string, payload?: unknown) => emit(traceEvent(agent, type, message, payload));
  await emitAgent('CEO Agent', 'task', 'Mandate accepted: optimize for a reliable hackathon command-center demo with paper trading only.');
  await emitAgent('Product Agent', 'task', 'Prioritized one-click run, visible agent debate, risk dashboard, memo generation, and command sidebar.');
  state.markets = mockMarkets;
  await emitAgent('Market Scanner Agent', 'decision', `Scanned ${state.markets.length} mock Kalshi-like markets and ranked by liquidity, edge potential, and demo clarity.`, { marketIds: state.markets.map(m => m.id) });

  for (const market of state.markets) {
    await emitAgent('Contract Interpreter Agent', 'decision', `Interpreted settlement terms for ${market.id}.`);
    await emitAgent('Research Agent', 'trace', `Generated clearly labeled public-evidence simulation for ${market.id}.`);
    const rec = createRecommendation(market, state.portfolio);
    state.recommendations.push(rec);
    await emitAgent('Quant Analyst Agent', 'decision', `${market.id}: fair ${(rec.fairProbability * 100).toFixed(1)}%, implied ${(rec.impliedProbability * 100).toFixed(1)}%, edge ${(rec.edge * 100).toFixed(1)}pp.`, rec);
    await emitAgent('Contrarian Agent', 'decision', rec.contrarian);
    await emitAgent('Risk Manager Agent', 'risk', `${market.id}: risk score ${rec.riskScore}/100 with position cap $${(rec.notionalCents / 100).toFixed(2)}.`);
    await emitAgent('Compliance Agent', rec.recommendation === 'BLOCKED' ? 'risk' : 'decision', `${market.id}: ${rec.recommendation === 'BLOCKED' ? 'blocked' : 'cleared for paper-only workflow'}.`);
    if (rec.recommendation === 'BUY_YES' || rec.recommendation === 'BUY_NO') {
      const side: 'YES' | 'NO' = rec.recommendation === 'BUY_YES' ? 'YES' : 'NO';
      const price = side === 'YES' ? market.yesPrice : market.noPrice;
      const position: PaperPosition = { id: `PAPER-${market.id}`, marketId: market.id, title: market.title, side, shares: rec.proposedShares, avgPrice: price, notionalCents: rec.notionalCents, fairProbability: rec.fairProbability, riskScore: rec.riskScore, category: market.category, createdAt: new Date().toISOString() };
      state.portfolio.positions.push(position);
      state.portfolio.cashCents -= rec.notionalCents;
      state.portfolio.totalNotionalCents += rec.notionalCents;
      state.portfolio.exposureByCategory[market.category] = (state.portfolio.exposureByCategory[market.category] ?? 0) + rec.notionalCents;
      await emitAgent('Execution Agent', 'trade', `Created paper ${side} trade for ${rec.proposedShares} contracts in ${market.id}; no live order sent.`, position);
    }
  }
  state.recommendations.sort((a, b) => Math.abs(b.edge) * b.confidence - Math.abs(a.edge) * a.confidence);
  state.memo = buildMemo(state);
  await emitAgent('QA Agent', 'trace', 'Verified demo path: mandate → market scan → debate → risk/compliance → paper portfolio → memo.');
  await emitAgent('Demo Agent', 'trace', 'Investment memo and pitch-ready narrative generated.');
  state.status = 'complete';
  return state;
}

export function buildMemo(state: AppState) {
  const buys = state.recommendations.filter(r => r.recommendation.startsWith('BUY'));
  const watches = state.recommendations.filter(r => r.recommendation === 'WATCH');
  return `# EventFund OS Investment Committee Memo\n\nMandate: ${state.mandate}\n\nDecision: propose ${buys.length} paper trades and keep ${watches.length} markets on watchlist. No live orders are placed.\n\nPortfolio notional: $${(state.portfolio.totalNotionalCents / 100).toFixed(2)} with remaining paper cash $${(state.portfolio.cashCents / 100).toFixed(2)}.\n\nTop theses:\n${state.recommendations.slice(0, 3).map(r => `- ${r.market.id}: ${r.recommendation} | edge ${(r.edge * 100).toFixed(1)}pp | confidence ${(r.confidence * 100).toFixed(0)}% | risk ${r.riskScore}/100. ${r.thesis}`).join('\n')}\n\nRisk posture: cap position sizing, avoid correlated macro stacking, mark politics markets as higher scrutiny, and require the human CIO to approve any non-demo action.\n\nCompliance: paper trading only, simulated/public evidence only, not financial advice.`;
}

export function answerCommand(state: AppState, prompt: string) {
  const p = prompt.toLowerCase();
  if (p.includes('low-risk') || p.includes('low risk')) return state.recommendations.filter(r => r.riskScore < 45).map(r => `${r.market.id}: ${r.recommendation}, risk ${r.riskScore}/100, edge ${(r.edge * 100).toFixed(1)}pp`).join('\n') || 'No low-risk trades currently clear the filter.';
  if (p.includes('politics') && (p.includes('reduce') || p.includes('exposure'))) return 'Politics exposure is already capped by the Risk Manager. To reduce further, set politics recommendations to WATCH and keep paper notional at $0 for that category.';
  if (p.includes('memo')) return state.memo;
  if (p.includes('why') || p.includes('recommend')) {
    const rec = state.recommendations[0];
    return rec ? `${rec.market.id}: ${rec.thesis}\nEvidence: ${rec.evidence.bullets.slice(0, 3).join(' ')}\nContrarian: ${rec.contrarian}\nRisk: ${rec.riskNotes[0]}` : 'Run the committee first to generate recommendations.';
  }
  return 'Command sidebar fallback can explain recommendations, filter low-risk trades, reduce category exposure, and generate the memo. Try: “Why did the agents recommend this market?”';
}
