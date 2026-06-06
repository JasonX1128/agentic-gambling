import type {
  AgentNode,
  ExecutiveReview,
  Market,
  Opportunity,
  PodLifecycleStatus,
  PodMandate,
  PodProposal,
  PortfolioSnapshot,
  ResearchScout,
  SectorPod
} from "@/lib/domain";
import { hydrateAgentPolicy } from "@/lib/agents/policy";

const ANALYST_ROLES = [
  "Data Analyst",
  "News Analyst",
  "Rules Analyst",
  "Market Microstructure Analyst",
  "Contrarian Agent",
  "Calibration Agent"
];

const nowIso = () => new Date().toISOString();

export function buildFundOperatingState(input: {
  markets: Market[];
  opportunities: Opportunity[];
  portfolio: PortfolioSnapshot;
}): {
  pods: SectorPod[];
  researchScouts: ResearchScout[];
  podProposals: PodProposal[];
  executiveReviews: ExecutiveReview[];
} {
  const podKeys = Array.from(new Set([
    ...input.markets.map((market) => classifyPodSector(market)),
    ...input.opportunities.map((opportunity) => classifyPodSector(opportunity.market)),
    ...input.portfolio.positions.map((position) => classifyTickerPod(position.ticker, position.sector)),
    ...input.portfolio.orders.map((order) => classifyTickerPod(order.ticker, order.sector)),
    ...input.portfolio.settlements.map((settlement) => classifyTickerPod(settlement.ticker, settlement.sector))
  ])).filter(Boolean);

  const pods = podKeys
    .map((podKey) => buildDynamicPod(podKey, input.markets, input.opportunities, input.portfolio))
    .sort((a, b) => b.mandate.mandateScore - a.mandate.mandateScore);
  const podProposals = buildPodProposals(pods, input.markets, input.opportunities);
  const researchScouts = buildResearchScouts(pods, podProposals, input.markets);
  const executiveReviews = pods
    .filter((pod) => pod.lifecycleStatus === "pip" || pod.lifecycleStatus === "defense" || pod.mandate.totalPnl < 0)
    .map((pod) => ({
      id: `review-${pod.id}`,
      podId: pod.id,
      sector: pod.sector,
      status: pod.lifecycleStatus === "defense" ? ("defense" as const) : ("pip" as const),
      pnl: pod.mandate.totalPnl,
      mandateScore: pod.mandate.mandateScore,
      questions: [
        "What public edge remains after observed losses?",
        "Which analyst call was wrong, and what changed in the prompt or sizing policy?",
        "What is the next smallest falsifiable paper probe?"
      ],
      decision:
        pod.lifecycleStatus === "defense"
          ? "Executive committee requires a defense memo before more risk budget."
          : "Pod is on PIP: reduce analyst count, cut size, and prove edge with smaller paper samples.",
      dueAt: pod.mandate.defenseDueAt ?? pod.mandate.nextReviewAt
    }));
  return { pods, researchScouts, podProposals, executiveReviews };
}

export function classifyPodSector(market: Market): string {
  return classifyTickerPod(market.ticker, market.sector, market.title);
}

export function classifyTickerPod(ticker: string, sector = "unclassified", title = ""): string {
  const text = `${ticker} ${title}`.toLowerCase();
  if (text.includes("xmlbteamtotal") || text.includes("xmlbtotal") || text.includes("total runs") || text.includes("score over")) {
    return "sports: baseball totals";
  }
  if (text.includes("xmlbspread") || text.includes("spread")) return "sports: spreads";
  if (text.includes("xmlbhrr") || text.includes("xmlbhit") || text.includes("hits + runs") || text.includes("rbi")) {
    return "sports: player props";
  }
  if (text.includes("cs2") || text.includes("map 1") || text.includes("roundsgg")) return "sports: esports maps";
  if (text.includes("fed") || text.includes("cpi") || sector === "macro") return "macro: rates inflation";
  if (text.includes("senate") || sector === "politics") return "politics: legislative";
  if (text.includes("hurricane") || sector === "climate") return "climate: weather events";
  if (text.includes("btc") || text.includes("crypto")) return "crypto: digital assets";
  return `${sector}: general`;
}

function buildDynamicPod(
  podKey: string,
  markets: Market[],
  opportunities: Opportunity[],
  portfolio: PortfolioSnapshot
): SectorPod {
  const podMarkets = markets.filter((market) => classifyPodSector(market) === podKey);
  const podOpportunities = opportunities.filter((opportunity) => classifyPodSector(opportunity.market) === podKey);
  const approved = podOpportunities.filter((opportunity) => opportunity.risk.approved && opportunity.compliance.approved);
  const blocked = podOpportunities.filter((opportunity) => !opportunity.risk.approved || !opportunity.compliance.approved);
  const podPnl = podPnlSnapshot(podKey, portfolio, markets);
  const hasCapital = podPnl.openExposure > 0 || podPnl.trades > 0 || podPnl.settlements > 0;
  const mandateScore = scoreMandate({
    pnl: podPnl.totalPnl,
    approved: approved.length,
    blocked: blocked.length,
    markets: podMarkets.length,
    openExposure: podPnl.openExposure
  });
  const lifecycleStatus = lifecycleFromMandate({ hasCapital, mandateScore, pnl: podPnl.totalPnl, approved: approved.length, markets: podMarkets.length });
  const analystCount = analystCountFor(lifecycleStatus, approved.length, podMarkets.length, podPnl.totalPnl);
  const mandate = buildMandate({
    podKey,
    lifecycleStatus,
    analystCount,
    marketCount: podMarkets.length,
    opportunityCount: podOpportunities.length,
    approvedOpportunityCount: approved.length,
    podPnl,
    mandateScore
  });
  return {
    id: `pod-${slug(podKey)}`,
    sector: podKey,
    agents: buildAgentsForPod(podKey, lifecycleStatus, analystCount, mandate),
    activeMarkets: podMarkets.length,
    blockedTrades: blocked.length,
    approvedCandidates: approved.length,
    lifecycleStatus,
    mandate
  };
}

function buildMandate(input: {
  podKey: string;
  lifecycleStatus: PodLifecycleStatus;
  analystCount: number;
  marketCount: number;
  opportunityCount: number;
  approvedOpportunityCount: number;
  podPnl: ReturnType<typeof podPnlSnapshot>;
  mandateScore: number;
}): PodMandate {
  const nextReviewHours =
    input.lifecycleStatus === "defense" ? 6 :
      input.lifecycleStatus === "pip" ? 12 :
        input.lifecycleStatus === "sleeping" ? 24 : 4;
  const nextReviewAt = futureHours(nextReviewHours);
  const actions =
    input.lifecycleStatus === "defense"
      ? ["Freeze scale-ups", "Write defense memo", "Close or settle stale positions"]
      : input.lifecycleStatus === "pip"
        ? ["Cut analyst count", "Reduce position size", "Show next falsifiable public-data edge"]
        : input.lifecycleStatus === "incubating"
          ? ["Assign seed analysts", "Run paper probes", "Escalate if first samples survive risk review"]
          : input.lifecycleStatus === "sleeping"
            ? ["Sleep research loop", "Wake when new Kalshi markets or material public catalysts appear"]
            : ["Continue scan", "Defend edge with PnL", "Refresh marks before next allocation"];
  return {
    status: input.lifecycleStatus,
    analystCount: input.analystCount,
    targetAnalystCount: targetAnalystCount(input.lifecycleStatus, input.approvedOpportunityCount),
    marketCount: input.marketCount,
    opportunityCount: input.opportunityCount,
    approvedOpportunityCount: input.approvedOpportunityCount,
    openExposure: input.podPnl.openExposure,
    realizedPnl: input.podPnl.realizedPnl,
    unrealizedPnl: input.podPnl.unrealizedPnl,
    totalPnl: input.podPnl.totalPnl,
    settledPnl: input.podPnl.settledPnl,
    closedPnl: input.podPnl.closedPnl,
    mandateScore: input.mandateScore,
    reviewCadence: input.lifecycleStatus === "sleeping" ? "sleep" : input.lifecycleStatus === "active" ? "continuous" : "hourly",
    nextReviewAt,
    sleepUntil: input.lifecycleStatus === "sleeping" ? nextReviewAt : undefined,
    pipStartedAt: input.lifecycleStatus === "pip" || input.lifecycleStatus === "defense" ? nowIso() : undefined,
    defenseDueAt: input.lifecycleStatus === "defense" ? futureHours(6) : undefined,
    thesis: thesisFor(input.podKey, input.approvedOpportunityCount, input.marketCount),
    executiveSummary: executiveSummaryFor(input.podKey, input.lifecycleStatus, input.podPnl.totalPnl, input.mandateScore),
    requiredDefense:
      input.lifecycleStatus === "defense" || input.lifecycleStatus === "pip"
        ? ["PnL attribution", "Thesis failure analysis", "Prompt/sizing changes", "Next probe budget"]
        : [],
    actions
  };
}

function buildAgentsForPod(podKey: string, lifecycleStatus: PodLifecycleStatus, analystCount: number, mandate: PodMandate): AgentNode[] {
  if (lifecycleStatus === "sleeping") {
    return [
      hydrateAgentPolicy({
        id: `${slug(podKey)}-sleeping-scout`,
        name: `${podKey.toUpperCase()} Sleeping Scout`,
        role: "Sector Discovery Researcher",
        status: "sleeping",
        sector: podKey,
        lastDecision: `No actionable pod proposal; sleeping until ${new Date(mandate.nextReviewAt).toLocaleTimeString()}.`
      })
    ];
  }
  const status = lifecycleStatus === "pip" ? "pip" : lifecycleStatus === "defense" ? "blocked" : "running";
  const coreRoles = ["Sector PM Agent", "Sector Risk Agent"];
  const analystRoles = ANALYST_ROLES.slice(0, Math.max(1, analystCount - coreRoles.length));
  return [...coreRoles, ...analystRoles].slice(0, analystCount).map((role, index) =>
    hydrateAgentPolicy({
      id: `${slug(podKey)}-${index}`,
      name: `${podKey.toUpperCase()} ${role}`,
      role,
      status,
      sector: podKey,
      lastDecision:
        lifecycleStatus === "defense"
          ? `Defending mandate to executives: total PnL $${mandate.totalPnl}, score ${mandate.mandateScore}.`
          : lifecycleStatus === "pip"
            ? `On PIP: shrink risk, explain losses, and prove ${podKey} still deserves analysts.`
            : lifecycleStatus === "incubating"
              ? "Incubating new pod with small paper probes before full mandate."
              : "Running continuous market scan, debate, and risk negotiation."
    })
  );
}

function buildPodProposals(pods: SectorPod[], markets: Market[], opportunities: Opportunity[]): PodProposal[] {
  const activePodSectors = new Set(pods.filter((pod) => pod.lifecycleStatus === "active" || pod.lifecycleStatus === "pip" || pod.lifecycleStatus === "defense").map((pod) => pod.sector));
  return pods
    .filter((pod) => pod.lifecycleStatus === "scouting" || pod.lifecycleStatus === "incubating" || (pod.approvedCandidates > 0 && !activePodSectors.has(pod.sector)))
    .map((pod) => {
      const confidence = Math.min(0.95, Math.max(0.2, 0.35 + pod.approvedCandidates * 0.12 + pod.activeMarkets * 0.04 + pod.mandate.mandateScore / 250));
      return {
        id: `proposal-${pod.id}`,
        proposedPodId: pod.id,
        sector: pod.sector,
        title: `Open ${pod.sector} pod`,
        status: pod.lifecycleStatus === "incubating" ? "incubating" : confidence > 0.55 ? "proposed" : "sleeping",
        confidence: Number(confidence.toFixed(2)),
        marketCount: markets.filter((market) => classifyPodSector(market) === pod.sector).length,
        opportunityCount: opportunities.filter((opportunity) => classifyPodSector(opportunity.market) === pod.sector).length,
        requiredAnalysts: pod.mandate.targetAnalystCount,
        proposedBy: `${pod.sector.toUpperCase()} Research Scout`,
        rationale: pod.mandate.thesis,
        risks: ["Thin liquidity can produce false paper edge", "Settlement rules must stay machine-readable", "Pod must survive PnL review after initial samples"],
        createdAt: nowIso(),
        sleepUntil: confidence <= 0.55 ? futureHours(12) : undefined
      };
    });
}

function buildResearchScouts(pods: SectorPod[], proposals: PodProposal[], markets: Market[]): ResearchScout[] {
  const proposalBySector = new Map(proposals.map((proposal) => [proposal.sector, proposal]));
  const sectors = Array.from(new Set([
    ...pods.map((pod) => pod.sector),
    ...markets.map((market) => classifyPodSector(market))
  ]));
  if (!sectors.length) {
    return [
      {
        id: "scout-general-sleeping",
        name: "Generalist Sector Scout",
        focus: "cross-market discovery",
        status: "sleeping",
        proposalsGenerated: 0,
        marketsReviewed: 0,
        lastFinding: "No Kalshi markets available for a new pod proposal.",
        sleepUntil: futureHours(6)
      }
    ];
  }
  return sectors.map((sector) => {
    const proposal = proposalBySector.get(sector);
    const reviewed = markets.filter((market) => classifyPodSector(market) === sector).length;
    return {
      id: `scout-${slug(sector)}`,
      name: `${sector.toUpperCase()} Sector Scout`,
      focus: sector,
      status: proposal ? "proposing" : reviewed > 0 ? "investigating" : "sleeping",
      proposalsGenerated: proposal ? 1 : 0,
      marketsReviewed: reviewed,
      lastFinding: proposal
        ? proposal.rationale
        : reviewed > 0
          ? "Still investigating; no executive-ready pod proposal yet."
          : "No fresh markets; sleeping before next sector sweep.",
      sleepUntil: proposal ? undefined : reviewed > 0 ? futureHours(4) : futureHours(12)
    };
  });
}

function podPnlSnapshot(podKey: string, portfolio: PortfolioSnapshot, markets: Market[]) {
  const marketMap = new Map(markets.map((market) => [market.ticker, market]));
  const positionRows = portfolio.positions.filter((position) => classifyTickerPod(position.ticker, position.sector, marketMap.get(position.ticker)?.title) === podKey);
  const orderRows = portfolio.orders.filter((order) => classifyTickerPod(order.ticker, order.sector, marketMap.get(order.ticker)?.title) === podKey);
  const settlementRows = portfolio.settlements.filter((settlement) => classifyTickerPod(settlement.ticker, settlement.sector, marketMap.get(settlement.ticker)?.title) === podKey);
  const closedPnl = orderRows
    .filter((order) => order.status === "paper_closed")
    .reduce((sum, order) => sum + (order.realizedPnl ?? 0), 0);
  const settledPnl = settlementRows.reduce((sum, settlement) => sum + settlement.realizedPnl, 0);
  const unrealizedPnl = positionRows.reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const openExposure = positionRows.reduce((sum, position) => sum + position.avgCost * (position.yesContracts + position.noContracts), 0);
  const realizedPnl = closedPnl + settledPnl;
  return {
    openExposure: money(openExposure),
    realizedPnl: money(realizedPnl),
    unrealizedPnl: money(unrealizedPnl),
    closedPnl: money(closedPnl),
    settledPnl: money(settledPnl),
    totalPnl: money(realizedPnl + unrealizedPnl),
    trades: orderRows.length,
    settlements: settlementRows.length
  };
}

function scoreMandate(input: { pnl: number; approved: number; blocked: number; markets: number; openExposure: number }) {
  return Math.max(
    0,
    Math.min(100, Math.round(45 + input.pnl * 2 + input.approved * 8 + input.markets * 3 - input.blocked * 5 - Math.max(0, input.openExposure - 250) / 20))
  );
}

function lifecycleFromMandate(input: { hasCapital: boolean; mandateScore: number; pnl: number; approved: number; markets: number }): PodLifecycleStatus {
  if (!input.markets && !input.hasCapital) return "sleeping";
  if (input.pnl <= -25 || (input.hasCapital && input.mandateScore < 25)) return "defense";
  if (input.pnl < 0 || (input.hasCapital && input.mandateScore < 40)) return "pip";
  if (input.hasCapital) return "active";
  if (input.approved >= 2 || input.mandateScore >= 60) return "incubating";
  return input.markets > 0 ? "scouting" : "sleeping";
}

function analystCountFor(status: PodLifecycleStatus, approved: number, markets: number, pnl: number): number {
  if (status === "sleeping") return 1;
  if (status === "defense") return 3;
  if (status === "pip") return 4;
  if (status === "incubating") return Math.min(7, 3 + approved);
  return Math.min(10, Math.max(5, 4 + approved + Math.floor(markets / 4) + (pnl > 10 ? 1 : 0)));
}

function targetAnalystCount(status: PodLifecycleStatus, approved: number) {
  if (status === "sleeping") return 0;
  if (status === "defense") return 2;
  if (status === "pip") return 3;
  if (status === "incubating") return Math.min(6, 3 + approved);
  return Math.min(10, 5 + approved);
}

function thesisFor(podKey: string, approved: number, markets: number) {
  if (approved > 0) return `${podKey} has ${approved} risk-approved paper candidates across ${markets} live Kalshi markets.`;
  if (markets > 0) return `${podKey} has live markets but needs a stronger public-data edge before a full pod mandate.`;
  return `${podKey} has no current market coverage and should sleep until new markets appear.`;
}

function executiveSummaryFor(podKey: string, status: PodLifecycleStatus, pnl: number, score: number) {
  if (status === "defense") return `${podKey} must defend existence: PnL $${pnl}, mandate score ${score}.`;
  if (status === "pip") return `${podKey} is on PIP: PnL $${pnl}, mandate score ${score}, reduced analysts.`;
  if (status === "incubating") return `${podKey} is proposed for incubation with small paper risk and limited analysts.`;
  if (status === "sleeping") return `${podKey} research is sleeping until new evidence or markets justify attention.`;
  return `${podKey} mandate is active and must continue proving edge through PnL and calibration.`;
}

function futureHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function money(value: number) {
  return Number(value.toFixed(2));
}
