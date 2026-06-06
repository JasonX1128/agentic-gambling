export type AgentName =
  | 'CEO Agent'
  | 'Product Agent'
  | 'Market Scanner Agent'
  | 'Contract Interpreter Agent'
  | 'Research Agent'
  | 'Quant Analyst Agent'
  | 'Contrarian Agent'
  | 'Risk Manager Agent'
  | 'Compliance Agent'
  | 'Execution Agent'
  | 'QA Agent'
  | 'Demo Agent';

export type MarketCategory = 'Politics' | 'Economics' | 'Climate' | 'Sports' | 'Culture' | 'Public Health';

export interface Market {
  id: string;
  title: string;
  category: MarketCategory;
  yesPrice: number;
  noPrice: number;
  volume: number;
  openInterest: number;
  closeTime: string;
  settlement: string;
  rules: string;
  liquidityScore: number;
  correlationBucket: string;
  source: 'mock-kalshi' | 'kalshi-api';
}

export interface Evidence {
  marketId: string;
  bullets: string[];
  sources: string[];
  simulated: boolean;
  freshness: string;
}

export interface DebatePoint {
  agent: AgentName;
  stance: 'support' | 'challenge' | 'neutral' | 'block' | 'approve';
  message: string;
  score?: number;
  ts: string;
}

export interface Recommendation {
  market: Market;
  interpretedContract: string;
  evidence: Evidence;
  fairProbability: number;
  impliedProbability: number;
  edge: number;
  confidence: number;
  riskScore: number;
  riskNotes: string[];
  complianceNotes: string[];
  recommendation: 'BUY_YES' | 'BUY_NO' | 'WATCH' | 'BLOCKED';
  thesis: string;
  contrarian: string;
  proposedShares: number;
  notionalCents: number;
  debate: DebatePoint[];
}

export interface PaperPosition {
  id: string;
  marketId: string;
  title: string;
  side: 'YES' | 'NO';
  shares: number;
  avgPrice: number;
  notionalCents: number;
  fairProbability: number;
  riskScore: number;
  category: MarketCategory;
  createdAt: string;
}

export interface Portfolio {
  cashCents: number;
  totalNotionalCents: number;
  positions: PaperPosition[];
  exposureByCategory: Record<string, number>;
  maxDrawdownLimitCents: number;
}

export interface TraceEvent {
  id: string;
  ts: string;
  agent: AgentName | 'System';
  type: 'task' | 'decision' | 'risk' | 'trade' | 'trace' | 'command';
  message: string;
  payload?: unknown;
}

export interface AppState {
  mandate: string;
  status: 'idle' | 'running' | 'complete';
  markets: Market[];
  recommendations: Recommendation[];
  portfolio: Portfolio;
  traces: TraceEvent[];
  memo: string;
  assumptions: string[];
  integrations: {
    redis: 'connected' | 'fallback-memory';
    weave: 'fallback-local-traces' | 'configured-placeholder';
    copilot: 'fallback-command-sidebar';
    kalshi: 'mock-data' | 'api-ready';
  };
}
