export type TradingMode = "paper" | "live";
export type IntegrationState = "complete" | "blocked" | "degraded";
export type OrderSide = "yes" | "no";
export type OrderAction = "buy" | "sell";
export type TradeSource = "agent" | "copilot" | "operator" | "demo";

export type IntegrationStatus = {
  name: "Kalshi" | "Redis" | "Weave" | "CopilotKit";
  state: IntegrationState;
  detail: string;
  required: string[];
  remediation: string[];
};

export type RiskLimits = {
  maxDailyLoss: number;
  maxWeeklyLoss: number;
  maxPositionSize: number;
  maxSectorExposure: number;
  maxCorrelatedExposure: number;
  maxOpenOrders: number;
  maxSlippageBps: number;
  minLiquidity: number;
  minConfidence: number;
  minEvidenceQuality: number;
  maxRuleAmbiguity: number;
  maxDrawdown: number;
  kellyFraction: number;
  riskAgentMaxPositionSize: number;
  riskAgentTargetSectorExposure: number;
  riskAgentTargetLiquidity: number;
  riskAgentTargetConfidence: number;
  riskAgentTargetSlippageBps: number;
  riskAgentMaxRiskScore: number;
};

export type Market = {
  id: string;
  ticker: string;
  eventTicker?: string;
  title: string;
  category: string;
  sector: string;
  status: "open" | "closed" | "settled" | "unknown";
  closeTime?: string;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  lastPrice: number;
  volume: number;
  openInterest: number;
  liquidity: number;
  ruleSummary: string;
  settlementSource: string;
  source: "kalshi" | "demo";
  updatedAt: string;
};

export type OrderBookLevel = {
  price: number;
  quantity: number;
};

export type OrderBook = {
  ticker: string;
  yes: OrderBookLevel[];
  no: OrderBookLevel[];
  updatedAt: string;
  source: "kalshi" | "demo";
};

export type EvidenceItem = {
  id: string;
  marketId: string;
  sourceType: "rules" | "market_data" | "public_context" | "agent_inference";
  title: string;
  url?: string;
  excerpt: string;
  credibilityScore: number;
  capturedAt: string;
};

export type AnalystDebateTurn = {
  agent: string;
  role: string;
  stance: "support" | "oppose" | "neutral";
  message: string;
  scoreImpact: number;
};

export type TradeThesis = {
  summary: string;
  bullCase: string[];
  bearCase: string[];
  invalidation: string[];
  evidence: EvidenceItem[];
};

export type Forecast = {
  marketId: string;
  marketProbability: number;
  fairProbability: number;
  expectedValue: number;
  confidence: number;
  liquidityQuality: number;
  uncertainty: number;
  downside: number;
  brierScore?: number;
  calibrationBucket: string;
};

export type RiskDecision = {
  approved: boolean;
  riskScore: number;
  positionSize: number;
  maxNotional: number;
  reasons: string[];
  blockedBy: string[];
  hardBlockedBy: string[];
  negotiableBlockedBy: string[];
  counterOffer: RiskCounterOffer;
  negotiation: RiskNegotiationTurn[];
};

export type RiskCounterOffer = {
  accepted: boolean;
  positionSize: number;
  maxEntryPrice: number;
  maxSpreadBps: number;
  conditions: string[];
  analystRequiredActions: string[];
};

export type RiskNegotiationTurn = {
  agent: string;
  role: string;
  stance: "support" | "oppose" | "neutral";
  message: string;
  scoreImpact: number;
  constraint?: string;
  proposedNotional?: number;
};

export type ComplianceDecision = {
  approved: boolean;
  policyVersion: string;
  humanApprovalRequired: boolean;
  blockedReasons: string[];
  warnings: string[];
};

export type Opportunity = {
  id: string;
  market: Market;
  side: OrderSide;
  rankScore: number;
  forecast: Forecast;
  thesis: TradeThesis;
  debate: AnalystDebateTurn[];
  risk: RiskDecision;
  compliance: ComplianceDecision;
  sector: string;
  podId: string;
  status: "candidate" | "blocked" | "approved_for_paper" | "paper_filled" | "live_ready";
  createdAt: string;
  traceId?: string;
};

export type TradeOrder = {
  id: string;
  opportunityId: string;
  ticker: string;
  sector: string;
  mode: TradingMode;
  action: OrderAction;
  side: OrderSide;
  quantity: number;
  limitPrice: number;
  status: "proposed" | "blocked" | "paper_filled" | "live_submitted" | "rejected" | "cancelled";
  source: TradeSource;
  auditId: string;
  traceId?: string;
  createdAt: string;
  filledAt?: string;
  rejectionReason?: string;
};

export type Position = {
  ticker: string;
  sector: string;
  yesContracts: number;
  noContracts: number;
  avgCost: number;
  markPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  mode: TradingMode;
};

export type PortfolioSnapshot = {
  mode: TradingMode;
  cash: number;
  availableCapital: number;
  netLiquidationValue: number;
  dailyPnl: number;
  weeklyPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openExposure: number;
  sectorExposure: Record<string, number>;
  positions: Position[];
  orders: TradeOrder[];
  updatedAt: string;
};

export type ActivityEvent = {
  id: string;
  type:
    | "market_sync"
    | "agent_decision"
    | "risk_check"
    | "compliance_check"
    | "paper_order"
    | "live_gate"
    | "blocked"
    | "postmortem"
    | "system";
  actor: string;
  message: string;
  severity: "info" | "warning" | "danger" | "success";
  createdAt: string;
  traceId?: string;
  payload?: Record<string, unknown>;
};

export type AgentNode = {
  id: string;
  name: string;
  role: string;
  status: "idle" | "running" | "blocked" | "complete";
  lastDecision: string;
  sector?: string;
  operatingMode?: "discover" | "debate" | "negotiate" | "approve" | "execute" | "monitor";
  decisionRights?: string[];
  systemPrompt?: string;
};

export type PaperCycleResult = {
  cycleId: string;
  evaluated: number;
  eligible: number;
  executed: number;
  blocked: number;
  skipped: number;
  orders: TradeOrder[];
  blockedOpportunities: Array<{ id: string; ticker: string; reasons: string[] }>;
  portfolio: PortfolioSnapshot;
  createdAt: string;
};

export type SectorPod = {
  id: string;
  sector: string;
  agents: AgentNode[];
  activeMarkets: number;
  blockedTrades: number;
  approvedCandidates: number;
};

export type DemoRun = {
  mode: TradingMode;
  marketSource: "kalshi" | "demo";
  marketBlocker?: string;
  markets: Market[];
  opportunities: Opportunity[];
  portfolio: PortfolioSnapshot;
  activity: ActivityEvent[];
  fundAgents: AgentNode[];
  pods: SectorPod[];
  integrationStatus: IntegrationStatus[];
};
