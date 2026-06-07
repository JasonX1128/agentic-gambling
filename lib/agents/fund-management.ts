import type {
  AgentNode,
  CrossPodBriefing,
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
import { actionsForLifecycle, getFundGovernancePolicy } from "@/lib/agents/operating-policy";
import { classifyTradingUniversePod, classifyTradingUniverseTicker } from "@/lib/markets/universe";

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
  crossPodBriefings: CrossPodBriefing[];
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
  const crossPodBriefings = buildCrossPodBriefings(pods, input.markets, input.opportunities);
  const executiveReviews = pods
    .filter((pod) => pod.lifecycleStatus === "pip" || pod.lifecycleStatus === "defense" || pod.mandate.totalPnl < 0)
    .map((pod) => ({
      id: `review-${pod.id}`,
      podId: pod.id,
      sector: pod.sector,
      status: pod.lifecycleStatus === "defense" ? ("defense" as const) : ("pip" as const),
      pnl: pod.mandate.totalPnl,
      mandateScore: pod.mandate.mandateScore,
      questions: getFundGovernancePolicy().executiveReviewQuestions,
      decision:
        pod.lifecycleStatus === "defense"
          ? getFundGovernancePolicy().executiveReviewDecisions.defense
          : getFundGovernancePolicy().executiveReviewDecisions.pip,
      dueAt: pod.mandate.defenseDueAt ?? pod.mandate.nextReviewAt
    }));
  return { pods, researchScouts, podProposals, executiveReviews, crossPodBriefings };
}

export function classifyPodSector(market: Market): string {
  return classifyTradingUniversePod(market);
}

export function classifyTickerPod(ticker: string, sector = "unclassified", title = "", category = ""): string {
  return classifyTradingUniverseTicker(ticker, sector, title, category);
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
  const governance = getFundGovernancePolicy();
  const nextReviewHours = reviewHoursFor(input.lifecycleStatus);
  const nextReviewAt = futureHours(nextReviewHours);
  const actions = actionsForLifecycle(input.lifecycleStatus, governance);
  const capitalBudget = capitalBudgetFor({
    status: input.lifecycleStatus,
    approved: input.approvedOpportunityCount,
    markets: input.marketCount,
    pnl: input.podPnl.totalPnl,
    mandateScore: input.mandateScore
  });
  const deployedCapital = input.podPnl.openExposure;
  const availableBudget = money(Math.max(0, capitalBudget - deployedCapital));
  return {
    status: input.lifecycleStatus,
    analystCount: input.analystCount,
    targetAnalystCount: targetAnalystCount(input.lifecycleStatus, input.approvedOpportunityCount),
    capitalBudget,
    deployedCapital,
    availableBudget,
    budgetUtilization: capitalBudget > 0 ? Number(Math.min(1, deployedCapital / capitalBudget).toFixed(3)) : 0,
    budgetDecision: budgetDecisionFor(input.lifecycleStatus, input.podPnl.totalPnl, capitalBudget),
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
    defenseDueAt: input.lifecycleStatus === "defense" ? futureHours(governance.reviewHours.defense) : undefined,
    thesis: thesisFor(input.podKey, input.approvedOpportunityCount, input.marketCount),
    executiveSummary: executiveSummaryFor(input.podKey, input.lifecycleStatus, input.podPnl.totalPnl, input.mandateScore),
    requiredDefense:
      input.lifecycleStatus === "defense" || input.lifecycleStatus === "pip"
        ? governance.requiredDefenseItems
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
        lastDecision: podAgentMessage(lifecycleStatus, podKey, mandate)
      })
    ];
  }
  const status = lifecycleStatus === "pip" ? "pip" : lifecycleStatus === "defense" ? "blocked" : "running";
  const coreRoles = ["Sector PM Agent", "Sector Risk Agent"];
  const analystRoles = getFundGovernancePolicy().analystRoles.slice(0, Math.max(1, analystCount - coreRoles.length));
  return [...coreRoles, ...analystRoles].slice(0, analystCount).map((role, index) =>
    hydrateAgentPolicy({
      id: `${slug(podKey)}-${index}`,
      name: `${podKey.toUpperCase()} ${role}`,
      role,
      status,
      sector: podKey,
      lastDecision: podAgentMessage(lifecycleStatus, podKey, mandate)
    })
  );
}

function buildPodProposals(pods: SectorPod[], markets: Market[], opportunities: Opportunity[]): PodProposal[] {
  const activePodSectors = new Set(pods.filter((pod) => pod.lifecycleStatus === "active" || pod.lifecycleStatus === "pip" || pod.lifecycleStatus === "defense").map((pod) => pod.sector));
  return pods
    .filter((pod) => pod.lifecycleStatus === "scouting" || pod.lifecycleStatus === "incubating" || (pod.approvedCandidates > 0 && !activePodSectors.has(pod.sector)))
    .map((pod) => {
      const proposal = getFundGovernancePolicy().proposalPolicy;
      const confidence = Math.min(
        proposal.maxConfidence,
        Math.max(
          proposal.minConfidence,
          proposal.baseConfidence +
            pod.approvedCandidates * proposal.approvedWeight +
            pod.activeMarkets * proposal.marketWeight +
            pod.mandate.mandateScore / proposal.mandateScoreDivisor
        )
      );
      return {
        id: `proposal-${pod.id}`,
        proposedPodId: pod.id,
        sector: pod.sector,
        title: `Open ${pod.sector} pod`,
        status: pod.lifecycleStatus === "incubating" ? "incubating" : confidence > proposal.proposalThreshold ? "proposed" : "sleeping",
        confidence: Number(confidence.toFixed(2)),
        marketCount: markets.filter((market) => classifyPodSector(market) === pod.sector).length,
        opportunityCount: opportunities.filter((opportunity) => classifyPodSector(opportunity.market) === pod.sector).length,
        requiredAnalysts: pod.mandate.targetAnalystCount,
        proposedBy: `${pod.sector.toUpperCase()} Research Scout`,
        rationale: pod.mandate.thesis,
        risks: proposal.risks,
        createdAt: nowIso(),
        sleepUntil: confidence <= proposal.proposalThreshold ? futureHours(getFundGovernancePolicy().reviewHours.proposalSleep) : undefined
      };
    });
}

function buildResearchScouts(pods: SectorPod[], proposals: PodProposal[], markets: Market[]): ResearchScout[] {
  const governance = getFundGovernancePolicy();
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
        lastFinding: governance.scoutMessages.noMarkets,
        sleepUntil: futureHours(governance.reviewHours.scoutNoMarkets)
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
          ? governance.scoutMessages.investigating
          : governance.scoutMessages.sleeping,
      sleepUntil: proposal ? undefined : reviewed > 0 ? futureHours(governance.reviewHours.scoutInvestigating) : futureHours(governance.reviewHours.proposalSleep)
    };
  });
}

function buildCrossPodBriefings(pods: SectorPod[], markets: Market[], opportunities: Opportunity[]): CrossPodBriefing[] {
  const collaboration = getFundGovernancePolicy().crossPodCollaboration;
  const viablePods = pods
    .filter((pod) => pod.lifecycleStatus !== "sleeping" && pod.lifecycleStatus !== "closed")
    .filter((pod) => pod.mandate.mandateScore >= collaboration.minSourceMandateScore || pod.approvedCandidates > 0)
    .sort((a, b) => podCollaborationScore(b) - podCollaborationScore(a));
  return viablePods.flatMap((pod, index) => {
    const targets = crossPodTargets(pod, pods).slice(0, collaboration.targetPodsPerBriefing);
    if (!targets.length) return [];
    const podMarkets = markets.filter((market) => classifyPodSector(market) === pod.sector);
    const podOpportunities = opportunities
      .filter((opportunity) => classifyPodSector(opportunity.market) === pod.sector)
      .sort((a, b) => b.rankScore - a.rankScore);
    return [{
      id: `brief-${slug(pod.sector)}-${index}`,
      fromPodId: pod.id,
      fromSector: pod.sector,
      toPodIds: targets.map((target) => target.id),
      toSectors: targets.map((target) => target.sector),
      analystRole: collaboration.sourceRoles[index % collaboration.sourceRoles.length],
      urgency: briefingUrgency(pod),
      insight: crossPodInsight(pod, targets, podMarkets, podOpportunities),
      watchItems: crossPodWatchItems(pod, targets, podOpportunities),
      proposedActions: crossPodProposedActions(pod, targets),
      relatedTickers: podOpportunities.slice(0, 3).map((opportunity) => opportunity.market.ticker),
      createdAt: nowIso(),
      nextCheckInAt: futureMinutes(collaboration.cadenceMinutes)
    }];
  }).slice(0, collaboration.maxBriefings);
}

function crossPodTargets(source: SectorPod, pods: SectorPod[]): SectorPod[] {
  const rules = getFundGovernancePolicy().crossPodCollaboration.relationshipRules;
  const explicitTargets = rules
    .filter((rule) => rule.fromSectorIncludes.some((token) => source.sector.toLowerCase().includes(token.toLowerCase())))
    .flatMap((rule) =>
      pods.filter((pod) =>
        pod.id !== source.id &&
        pod.lifecycleStatus !== "sleeping" &&
        pod.lifecycleStatus !== "closed" &&
        rule.toSectorIncludes.some((token) => pod.sector.toLowerCase().includes(token.toLowerCase()))
      )
    );
  const fallbackTargets = pods.filter((pod) => pod.id !== source.id && pod.lifecycleStatus !== "sleeping" && pod.lifecycleStatus !== "closed");
  return uniquePods([...explicitTargets, ...fallbackTargets]).sort((a, b) => podCollaborationScore(b) - podCollaborationScore(a));
}

function crossPodInsight(source: SectorPod, targets: SectorPod[], markets: Market[], opportunities: Opportunity[]): string {
  const bestOpportunity = opportunities[0];
  const targetList = targets.map((target) => target.sector).join(", ");
  const relationship = relationshipRationale(source.sector, targets.map((target) => target.sector));
  if (bestOpportunity) {
    return `${source.sector} sees ${source.approvedCandidates} approved candidates and top signal ${bestOpportunity.market.ticker}; ${targetList} should account for ${relationship}`;
  }
  return `${source.sector} is monitoring ${markets.length} live markets; ${targetList} should account for ${relationship}`;
}

function crossPodWatchItems(source: SectorPod, targets: SectorPod[], opportunities: Opportunity[]): string[] {
  const bestOpportunity = opportunities[0];
  const items = [
    `${source.sector} budget ${source.mandate.capitalBudget}, deployed ${source.mandate.deployedCapital}, PnL ${source.mandate.totalPnl}.`,
    `Target pods: ${targets.map((target) => target.sector).join(", ")}.`
  ];
  if (bestOpportunity) {
    items.push(
      `Top cross-read: ${bestOpportunity.market.title} has ${Math.abs(bestOpportunity.forecast.expectedValue * 100).toFixed(1)} point edge and ${timeToCloseLabel(bestOpportunity.market.closeTime)} to close.`
    );
  }
  if (source.lifecycleStatus === "pip" || source.lifecycleStatus === "defense") {
    items.push("Treat this pod's signal cautiously until its PnL review clears.");
  }
  return items;
}

function crossPodProposedActions(source: SectorPod, targets: SectorPod[]): string[] {
  const actions = [
    `Ask ${targets[0]?.sector ?? "target pod"} PM to compare settlement-rule ambiguity against ${source.sector}.`,
    "Share liquidity/spread changes before the next CIO paper cycle."
  ];
  if (source.lifecycleStatus === "incubating" || source.lifecycleStatus === "scouting") {
    actions.push("Use only seed-probe sizing until the cross-pod thesis survives first fill.");
  }
  if (source.mandate.totalPnl > 0) {
    actions.push("Let receiving pods test whether the same public catalyst explains their own mispriced contracts.");
  }
  return actions;
}

function briefingUrgency(pod: SectorPod): CrossPodBriefing["urgency"] {
  if (pod.lifecycleStatus === "pip" || pod.lifecycleStatus === "defense") return "escalate";
  if (pod.mandate.totalPnl !== 0 || pod.approvedCandidates >= 5) return "watch";
  return "routine";
}

function relationshipRationale(fromSector: string, toSectors: string[]): string {
  const rules = getFundGovernancePolicy().crossPodCollaboration.relationshipRules;
  const rule = rules.find((candidate) =>
    candidate.fromSectorIncludes.some((token) => fromSector.toLowerCase().includes(token.toLowerCase())) &&
    toSectors.some((sector) => candidate.toSectorIncludes.some((token) => sector.toLowerCase().includes(token.toLowerCase())))
  );
  return rule?.rationale ?? "shared liquidity, catalysts, duplicated exposure, or public-information assumptions.";
}

function podCollaborationScore(pod: SectorPod): number {
  return pod.mandate.mandateScore + pod.approvedCandidates * 5 + Math.max(0, pod.mandate.totalPnl) * 2 - Math.max(0, -pod.mandate.totalPnl) * 3;
}

function uniquePods(pods: SectorPod[]): SectorPod[] {
  return [...new Map(pods.map((pod) => [pod.id, pod])).values()];
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
  const scoring = getFundGovernancePolicy().mandateScoring;
  return Math.max(
    scoring.minScore,
    Math.min(
      scoring.maxScore,
      Math.round(
        scoring.base +
          input.pnl * scoring.pnlMultiplier +
          input.approved * scoring.approvedOpportunityWeight +
          input.markets * scoring.marketWeight -
          input.blocked * scoring.blockedPenalty -
          Math.max(0, input.openExposure - scoring.exposurePenaltyThreshold) / scoring.exposurePenaltyDivisor
      )
    )
  );
}

function lifecycleFromMandate(input: { hasCapital: boolean; mandateScore: number; pnl: number; approved: number; markets: number }): PodLifecycleStatus {
  const thresholds = getFundGovernancePolicy().lifecycleThresholds;
  if (!input.markets && !input.hasCapital) return "sleeping";
  if (input.pnl <= thresholds.defensePnl || (input.hasCapital && input.mandateScore < thresholds.defenseScore)) return "defense";
  if (input.pnl < thresholds.pipPnl || (input.hasCapital && input.mandateScore < thresholds.pipScore)) return "pip";
  if (input.hasCapital) return "active";
  if (input.approved >= thresholds.activeApprovedOpportunities && input.mandateScore >= thresholds.activeScore) return "active";
  if (input.approved >= thresholds.incubatingApprovedOpportunities || input.mandateScore >= thresholds.incubatingScore) return "incubating";
  return input.markets > 0 ? "scouting" : "sleeping";
}

function capitalBudgetFor(input: {
  status: PodLifecycleStatus;
  approved: number;
  markets: number;
  pnl: number;
  mandateScore: number;
}): number {
  const budget = getFundGovernancePolicy().capitalBudgeting;
  const base = baseBudgetFor(input.status);
  if (base <= 0) return 0;
  const pipelineBudget = input.approved * budget.approvedOpportunityDollars + input.markets * budget.marketDollars;
  const scoreBudget = Math.max(0, input.mandateScore - 50) * budget.scoreBonusDollars;
  const performanceBudget =
    input.pnl >= 0 ? input.pnl * budget.positivePnlMultiplier : input.pnl * budget.lossShrinkMultiplier;
  return money(Math.max(0, Math.min(budget.maxPodBudget, base + pipelineBudget + scoreBudget + performanceBudget)));
}

function baseBudgetFor(status: PodLifecycleStatus): number {
  const budget = getFundGovernancePolicy().capitalBudgeting;
  if (status === "sleeping" || status === "closed") return budget.sleepingBaseBudget;
  if (status === "defense") return budget.defenseBaseBudget;
  if (status === "pip") return budget.pipBaseBudget;
  if (status === "incubating" || status === "scouting") return budget.incubatingBaseBudget;
  return budget.activeBaseBudget;
}

function budgetDecisionFor(status: PodLifecycleStatus, pnl: number, budget: number): string {
  if (status === "defense") return "Budget frozen while the pod defends or exits risk.";
  if (status === "sleeping" || status === "closed") return "No capital budget until scouts find viable markets.";
  if (status === "pip") return `Budget shrunk to $${budget} while the pod proves recovery.`;
  if (status === "incubating" || status === "scouting") return `Seed budget $${budget} for first paper probes.`;
  if (pnl > 0) return `Budget expanded to $${budget} after positive paper PnL.`;
  return `Active budget $${budget}; deploy across approved pod opportunities.`;
}

function analystCountFor(status: PodLifecycleStatus, approved: number, markets: number, pnl: number): number {
  const counts = getFundGovernancePolicy().analystCounts;
  if (status === "sleeping") return counts.sleeping.current;
  if (status === "defense") return counts.defense.current;
  if (status === "pip") return counts.pip.current;
  if (status === "incubating") return Math.min(counts.incubating.max, counts.incubating.base + approved * counts.incubating.approvedMultiplier);
  const activeCount =
    counts.active.base +
    approved * counts.active.approvedMultiplier +
    Math.floor(markets / counts.active.marketsDivisor) +
    (pnl > counts.active.positivePnlBonusThreshold ? counts.active.positivePnlBonus : 0);
  return Math.min(counts.active.max, Math.max(counts.active.min, activeCount));
}

function targetAnalystCount(status: PodLifecycleStatus, approved: number) {
  const counts = getFundGovernancePolicy().analystCounts;
  if (status === "sleeping") return counts.sleeping.target;
  if (status === "defense") return counts.defense.target;
  if (status === "pip") return counts.pip.target;
  if (status === "incubating") return Math.min(counts.incubating.targetMax, counts.incubating.base + approved * counts.incubating.approvedMultiplier);
  return Math.min(counts.active.targetMax, counts.active.targetBase + approved);
}

function thesisFor(podKey: string, approved: number, markets: number) {
  const templates = getFundGovernancePolicy().thesisTemplates;
  if (approved > 0) return renderTemplate(templates.approved, { podKey, approved, markets });
  if (markets > 0) return renderTemplate(templates.markets, { podKey, approved, markets });
  return renderTemplate(templates.none, { podKey, approved, markets });
}

function executiveSummaryFor(podKey: string, status: PodLifecycleStatus, pnl: number, score: number) {
  const templates = getFundGovernancePolicy().executiveSummaryTemplates;
  const template =
    status === "defense" ? templates.defense :
      status === "pip" ? templates.pip :
        status === "incubating" ? templates.incubating :
          status === "sleeping" ? templates.sleeping :
            status === "scouting" ? templates.scouting : templates.active;
  return renderTemplate(template, { podKey, pnl, score });
}

function reviewHoursFor(status: PodLifecycleStatus) {
  const hours = getFundGovernancePolicy().reviewHours;
  if (status === "defense") return hours.defense;
  if (status === "pip") return hours.pip;
  if (status === "sleeping") return hours.sleeping;
  return hours.default;
}

function podAgentMessage(status: PodLifecycleStatus, podKey: string, mandate: PodMandate) {
  const messages = getFundGovernancePolicy().podAgentMessages;
  if (status === "sleeping") {
    return renderTemplate(messages.sleeping, { reviewTime: new Date(mandate.nextReviewAt).toLocaleTimeString(), podKey });
  }
  if (status === "defense") return renderTemplate(messages.defense, { podKey, pnl: mandate.totalPnl, score: mandate.mandateScore });
  if (status === "pip") return renderTemplate(messages.pip, { podKey, pnl: mandate.totalPnl, score: mandate.mandateScore });
  if (status === "incubating") return renderTemplate(messages.incubating, { podKey, pnl: mandate.totalPnl, score: mandate.mandateScore });
  return renderTemplate(messages.active, { podKey, pnl: mandate.totalPnl, score: mandate.mandateScore });
}

function renderTemplate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function futureHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function futureMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function timeToCloseLabel(closeTime?: string): string {
  if (!closeTime) return "unknown horizon";
  const ms = Date.parse(closeTime) - Date.now();
  if (!Number.isFinite(ms)) return "unknown horizon";
  if (ms <= 0) return "closed";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function money(value: number) {
  return Number(value.toFixed(2));
}
