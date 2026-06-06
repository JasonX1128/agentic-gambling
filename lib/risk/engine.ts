import type { Forecast, Market, PortfolioSnapshot, RiskDecision, RiskLimits, RiskNegotiationTurn } from "@/lib/domain";
import { cappedFractionalKelly, clamp } from "@/lib/quant/scoring";
import { eventClusterExposure, eventClusterKey } from "@/lib/risk/event-cluster";

export type RiskInput = {
  market: Market;
  forecast: Forecast;
  requestedNotional: number;
  portfolio?: PortfolioSnapshot;
};

export function evaluateRisk(input: RiskInput, limits: RiskLimits): RiskDecision {
  const reasons: string[] = [];
  const blockedBy: string[] = [];
  const hardBlockedBy: string[] = [];
  const negotiableBlockedBy: string[] = [];
  const conditions: string[] = [];
  const analystRequiredActions: string[] = [];
  const negotiation: RiskNegotiationTurn[] = [];
  const portfolio = input.portfolio;
  const sectorExposure = portfolio?.sectorExposure[input.market.sector] ?? 0;
  const clusterKey = eventClusterKey(input.market);
  const clusterExposure = eventClusterExposure({ portfolio, market: input.market });
  const openOrders = portfolio?.orders.filter((order) => order.status === "proposed" || order.status === "live_submitted").length ?? 0;
  const dailyLoss = Math.min(0, portfolio?.dailyPnl ?? 0);
  const weeklyLoss = Math.min(0, portfolio?.weeklyPnl ?? 0);
  const inferredSide = input.forecast.expectedValue >= 0 ? "yes" : "no";
  const existingPosition = portfolio?.positions.find((position) => position.ticker === input.market.ticker);
  const hasOppositePosition =
    Boolean(existingPosition) &&
    ((inferredSide === "yes" && (existingPosition?.noContracts ?? 0) > 0) ||
      (inferredSide === "no" && (existingPosition?.yesContracts ?? 0) > 0));
  const entryBid = inferredSide === "yes" ? input.market.yesBid : input.market.noBid;
  const entryAsk = inferredSide === "yes" ? input.market.yesAsk : input.market.noAsk;
  const spreadCents = Math.max(0, entryAsk - entryBid);
  const spreadBps = spreadCents * 100;
  const sideMarketProbability =
    inferredSide === "yes" ? input.forecast.marketProbability : 1 - input.forecast.marketProbability;
  const sideFairProbability = inferredSide === "yes" ? input.forecast.fairProbability : 1 - input.forecast.fairProbability;
  const directionalEdge = Math.max(0, sideFairProbability - sideMarketProbability);
  const remainingSectorCapacity = Math.max(0, limits.maxSectorExposure - sectorExposure);
  const remainingClusterCapacity = Math.max(0, limits.maxCorrelatedExposure - clusterExposure);
  const hardNotionalCap = Math.min(limits.maxPositionSize, remainingSectorCapacity, remainingClusterCapacity);
  const remainingRiskAgentSectorCapacity = Math.max(0, limits.riskAgentTargetSectorExposure - sectorExposure);
  const riskAgentNotionalCap = Math.min(
    limits.riskAgentMaxPositionSize,
    remainingRiskAgentSectorCapacity > 0 ? remainingRiskAgentSectorCapacity : limits.riskAgentMaxPositionSize * 0.25
  );
  const kellySize = cappedFractionalKelly({
    probability: sideFairProbability,
    price: sideMarketProbability,
    bankroll: portfolio?.availableCapital ?? 10000,
    fraction: limits.kellyFraction,
    cap: limits.maxPositionSize
  });
  const rawCounterSize = Math.min(input.requestedNotional, hardNotionalCap, riskAgentNotionalCap, Math.max(0, kellySize));
  const qualityMultiplier = clamp(
    0.2 + input.forecast.confidence * 0.35 + input.forecast.liquidityQuality * 0.25 + directionalEdge * 0.3,
    0.1,
    0.85
  );
  const counterOfferSize = Number(Math.max(0, rawCounterSize * qualityMultiplier).toFixed(2));
  const maxEntryPrice = Math.max(0, Math.min(100, entryAsk));

  negotiation.push({
    agent: "Sector PM Agent",
    role: "Analyst Proposal",
    stance: "support",
    message: `Proposes ${inferredSide.toUpperCase()} ${input.market.ticker} with requested notional $${input.requestedNotional.toFixed(2)} before independent risk review.`,
    scoreImpact: 0.02,
    proposedNotional: input.requestedNotional
  });

  if (input.requestedNotional > limits.maxPositionSize) {
    negotiableBlockedBy.push("MAX_POSITION_SIZE");
    reasons.push(`Risk capped requested notional ${input.requestedNotional.toFixed(2)} to max position size ${limits.maxPositionSize}.`);
    negotiation.push({
      agent: "Chief Risk Officer Agent",
      role: "Risk Counterparty",
      stance: "oppose",
      message: `Will not underwrite $${input.requestedNotional.toFixed(2)}; hard position cap is $${limits.maxPositionSize}.`,
      scoreImpact: -0.08,
      constraint: "MAX_POSITION_SIZE",
      proposedNotional: limits.maxPositionSize
    });
  }
  if (input.requestedNotional > limits.riskAgentMaxPositionSize) {
    negotiableBlockedBy.push("RISK_AGENT_SIZE");
    reasons.push(`Risk Agent target size is ${limits.riskAgentMaxPositionSize}; requested notional is ${input.requestedNotional.toFixed(2)}.`);
    conditions.push(`Use Risk Agent-sized notional <= $${limits.riskAgentMaxPositionSize}.`);
  }
  if (remainingSectorCapacity <= 0) {
    hardBlockedBy.push("MAX_SECTOR_EXPOSURE");
    reasons.push(`Sector exposure is already at the configured cap ${limits.maxSectorExposure}.`);
  } else if (sectorExposure + input.requestedNotional > limits.maxSectorExposure) {
    negotiableBlockedBy.push("MAX_SECTOR_EXPOSURE");
    reasons.push(`Risk capped notional to remaining sector capacity ${remainingSectorCapacity}.`);
    negotiation.push({
      agent: "Chief Risk Officer Agent",
      role: "Risk Counterparty",
      stance: "oppose",
      message: `Sector book has $${remainingSectorCapacity.toFixed(2)} capacity left; analysts must fit inside that cap.`,
      scoreImpact: -0.07,
      constraint: "MAX_SECTOR_EXPOSURE",
      proposedNotional: remainingSectorCapacity
    });
  }
  if (sectorExposure + input.requestedNotional > limits.riskAgentTargetSectorExposure) {
    negotiableBlockedBy.push("RISK_AGENT_SECTOR_TARGET");
    reasons.push(`Risk Agent sector target ${limits.riskAgentTargetSectorExposure} would be exceeded.`);
    conditions.push("Risk Agent reduced size because sector target exposure is already crowded.");
  }
  if (remainingClusterCapacity <= 0) {
    hardBlockedBy.push("MAX_CORRELATED_EXPOSURE");
    reasons.push(`Event cluster ${clusterKey} is already at the correlated exposure cap ${limits.maxCorrelatedExposure}.`);
  } else if (clusterExposure + input.requestedNotional > limits.maxCorrelatedExposure) {
    negotiableBlockedBy.push("MAX_CORRELATED_EXPOSURE");
    reasons.push(`Risk capped notional to remaining event-cluster capacity ${remainingClusterCapacity}.`);
    conditions.push(`Stay within correlated event cluster ${clusterKey} capacity of $${remainingClusterCapacity.toFixed(2)}.`);
    negotiation.push({
      agent: "Chief Risk Officer Agent",
      role: "Cluster Risk Counterparty",
      stance: "oppose",
      message: `Related contract exposure in ${clusterKey} leaves $${remainingClusterCapacity.toFixed(2)} of capacity before duplicated-risk limits bind.`,
      scoreImpact: -0.08,
      constraint: "MAX_CORRELATED_EXPOSURE",
      proposedNotional: remainingClusterCapacity
    });
  }
  if (openOrders >= limits.maxOpenOrders) {
    hardBlockedBy.push("MAX_OPEN_ORDERS");
    reasons.push("Open order count is already at the configured limit.");
  }
  if (hasOppositePosition) {
    hardBlockedBy.push("OPPOSITE_POSITION");
    reasons.push("Portfolio already holds the opposite side in this market; close the existing paper position before adding reverse exposure.");
    analystRequiredActions.push("Execution Supervisor Agent must close or settle the existing paper position before the Sector PM can reverse the side.");
  }
  if (Math.abs(dailyLoss) >= limits.maxDailyLoss) {
    hardBlockedBy.push("MAX_DAILY_LOSS");
    reasons.push("Daily loss limit has been reached.");
  }
  if (Math.abs(weeklyLoss) >= limits.maxWeeklyLoss) {
    hardBlockedBy.push("MAX_WEEKLY_LOSS");
    reasons.push("Weekly loss limit has been reached.");
  }
  if (input.market.liquidity < limits.minLiquidity) {
    hardBlockedBy.push("MIN_LIQUIDITY");
    reasons.push(`Liquidity ${input.market.liquidity} is below hard minimum ${limits.minLiquidity}.`);
    conditions.push(`Wait for quoted liquidity >= hard minimum ${limits.minLiquidity}.`);
    analystRequiredActions.push("Market Microstructure Analyst must re-check book depth before execution.");
  } else if (input.market.liquidity < limits.riskAgentTargetLiquidity) {
    negotiableBlockedBy.push("RISK_AGENT_LIQUIDITY");
    reasons.push(`Liquidity ${input.market.liquidity} is below Risk Agent target ${limits.riskAgentTargetLiquidity}.`);
    conditions.push(`Do not scale beyond probe size until quoted liquidity >= ${limits.riskAgentTargetLiquidity}.`);
    analystRequiredActions.push("Market Microstructure Analyst must monitor book depth and resubmit if liquidity improves.");
  }
  if (spreadBps > limits.maxSlippageBps) {
    hardBlockedBy.push("MAX_SLIPPAGE");
    reasons.push(`Bid/ask spread ${spreadBps} bps exceeds hard max slippage ${limits.maxSlippageBps} bps.`);
    conditions.push(`Do not execute until bid/ask spread <= hard max ${limits.maxSlippageBps} bps.`);
    analystRequiredActions.push("Microstructure Analyst must resubmit with a tighter limit or wait for a tighter market.");
  } else if (spreadBps > limits.riskAgentTargetSlippageBps) {
    negotiableBlockedBy.push("RISK_AGENT_SPREAD");
    reasons.push(`Spread ${spreadBps} bps is wider than Risk Agent target ${limits.riskAgentTargetSlippageBps} bps.`);
    conditions.push(`Risk allows only negotiated size while spread is above ${limits.riskAgentTargetSlippageBps} bps.`);
    analystRequiredActions.push("Microstructure Analyst should prefer passive limits and avoid scaling until spread tightens.");
  }
  if (input.forecast.confidence < limits.minConfidence) {
    hardBlockedBy.push("MIN_CONFIDENCE");
    reasons.push(`Confidence ${input.forecast.confidence.toFixed(2)} is below hard minimum ${limits.minConfidence}.`);
    conditions.push(`Raise model confidence to >= hard minimum ${limits.minConfidence}.`);
    analystRequiredActions.push("Data Analyst and Calibration Agent must add evidence or lower conviction.");
  } else if (input.forecast.confidence < limits.riskAgentTargetConfidence) {
    negotiableBlockedBy.push("RISK_AGENT_CONFIDENCE");
    reasons.push(`Confidence ${input.forecast.confidence.toFixed(2)} is below Risk Agent target ${limits.riskAgentTargetConfidence}.`);
    conditions.push("Risk reduced size because confidence is below target.");
    analystRequiredActions.push("Data Analyst and Calibration Agent should add public evidence before scaling.");
  }
  if (directionalEdge <= 0) {
    negotiableBlockedBy.push("NO_DIRECTIONAL_EDGE");
    blockedBy.push("RISK_AGENT_REJECTED");
    reasons.push("Risk Agent rejected: selected side has no positive directional edge.");
    conditions.push("No order until the selected side has positive expected value after transaction costs.");
    analystRequiredActions.push("Sector PM must either improve the thesis with public evidence or stand down.");
  }
  blockedBy.unshift(...hardBlockedBy);

  if (hardBlockedBy.length > 0) {
    negotiation.push({
      agent: "Chief Risk Officer Agent",
      role: "Hard Gate",
      stance: "oppose",
      message: `Hard stop: ${hardBlockedBy.join(", ")} cannot be negotiated by analysts.`,
      scoreImpact: -0.3,
      constraint: hardBlockedBy.join(", "),
      proposedNotional: 0
    });
  }

  const riskScore = Math.min(
    100,
    Math.round(
        input.forecast.downside * 35 +
        (1 - input.forecast.confidence) * 25 +
        (1 - input.forecast.liquidityQuality) * 20 +
        (Math.min(input.requestedNotional, riskAgentNotionalCap) / Math.max(1, limits.riskAgentMaxPositionSize)) * 20
    )
  );

  if (riskScore > limits.riskAgentMaxRiskScore) {
    negotiableBlockedBy.push("RISK_AGENT_RISK_SCORE");
    blockedBy.push("RISK_AGENT_REJECTED");
    reasons.push(`Risk score ${riskScore} exceeds Risk Agent tolerance ${limits.riskAgentMaxRiskScore}.`);
    conditions.push("Risk Agent requires smaller size, better liquidity, tighter spread, or stronger evidence before approval.");
    analystRequiredActions.push("Sector PM must renegotiate size and thesis quality with the Chief Risk Officer Agent.");
  }

  if (blockedBy.length > hardBlockedBy.length) {
    negotiation.push({
      agent: "Chief Risk Officer Agent",
      role: "Risk Counteroffer",
      stance: "neutral",
      message: `Risk will reconsider at $${counterOfferSize.toFixed(2)} only after unmet market/thesis conditions clear.`,
      scoreImpact: -0.12,
      proposedNotional: counterOfferSize
    });
  }

  if (negotiableBlockedBy.includes("MAX_POSITION_SIZE") || negotiableBlockedBy.includes("MAX_SECTOR_EXPOSURE")) {
    negotiation.push({
      agent: "Sector PM Agent",
      role: "Analyst Concession",
      stance: "neutral",
      message: `Accepts risk-sized notional of $${counterOfferSize.toFixed(2)} instead of the original request.`,
      scoreImpact: 0.03,
      proposedNotional: counterOfferSize
    });
  }

  if (conditions.length > 0) {
    negotiation.push({
      agent: "Market Microstructure Analyst",
      role: "Execution Constraint",
      stance: "neutral",
      message: conditions[0],
      scoreImpact: -0.04,
      constraint: [...blockedBy, ...negotiableBlockedBy].find((item) => item.includes("SLIPPAGE") || item.includes("SPREAD") || item.includes("LIQUIDITY"))
    });
  }

  const approved = blockedBy.length === 0 && counterOfferSize > 0;
  if (approved) {
    conditions.push(`Use risk-sized notional <= $${counterOfferSize.toFixed(2)}.`);
    conditions.push(`Limit ${inferredSide.toUpperCase()} entry at or below ${maxEntryPrice} cents; hard-cancel if spread widens above ${limits.maxSlippageBps} bps.`);
    negotiation.push({
      agent: "Chief Risk Officer Agent",
      role: "Conditional Approval",
      stance: "support",
      message: `Approves only the negotiated ${inferredSide.toUpperCase()} size: $${counterOfferSize.toFixed(2)} with current hard limits intact.`,
      scoreImpact: 0.08,
      proposedNotional: counterOfferSize
    });
  }

  return {
    approved,
    riskScore,
    positionSize: approved ? counterOfferSize : 0,
    maxNotional: limits.maxPositionSize,
    reasons: reasons.length ? reasons : ["Within configured pre-trade risk limits."],
    blockedBy: Array.from(new Set(blockedBy)),
    hardBlockedBy: Array.from(new Set(hardBlockedBy)),
    negotiableBlockedBy: Array.from(new Set(negotiableBlockedBy)),
    counterOffer: {
      accepted: approved,
      positionSize: counterOfferSize,
      maxEntryPrice,
      maxSpreadBps: limits.riskAgentTargetSlippageBps,
      conditions,
      analystRequiredActions
    },
    negotiation
  };
}

export function liveGateDecision(input: {
  requestedMode: string;
  enableLiveTrading: boolean;
  globalKillSwitch: boolean;
  missingPrerequisites: string[];
}): { approved: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.requestedMode !== "live") reasons.push("TRADING_MODE is not live.");
  if (!input.enableLiveTrading) reasons.push("ENABLE_LIVE_TRADING is not true.");
  if (input.globalKillSwitch) reasons.push("GLOBAL_KILL_SWITCH is active.");
  reasons.push(...input.missingPrerequisites.map((item) => `Missing ${item}.`));
  return {
    approved: reasons.length === 0,
    reasons: reasons.length ? reasons : ["Live gate prerequisites satisfied."]
  };
}
