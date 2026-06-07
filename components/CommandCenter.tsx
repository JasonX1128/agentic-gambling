"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  CircuitBoard,
  ClipboardCheck,
  Gauge,
  Landmark,
  Search,
  ShieldAlert,
  SquareActivity,
  StopCircle,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AgentNode,
  DemoRun,
  ExecutiveReview,
  IntegrationStatus,
  Market,
  Opportunity,
  PodProposal,
  PortfolioSnapshot,
  ResearchScout,
  SectorPod
} from "@/lib/domain";
import { StatusPill } from "@/components/ui/StatusPill";
import { EventFundCopilotActions } from "@/components/copilot/EventFundCopilotActions";
import { Providers } from "@/app/providers";

export function CommandCenter({ initialData }: { initialData: DemoRun }) {
  const [data, setData] = useState(initialData);
  const [lastRefresh, setLastRefresh] = useState(initialData.portfolio.updatedAt);
  const [marketFilter, setMarketFilter] = useState("");
  const [opportunityFilter, setOpportunityFilter] = useState("");
  const [expandedMarketId, setExpandedMarketId] = useState<string>();
  const [expandedOpportunityId, setExpandedOpportunityId] = useState<string>();

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/demo/run", {
          method: "POST",
          cache: "no-store"
        });
        if (!response.ok) return;
        const next = (await response.json()) as DemoRun;
        if (!active) return;
        setData(next);
        setLastRefresh(new Date().toISOString());
      } catch {
        // Keep the current dashboard snapshot if a refresh request fails.
      }
    };
    const id = window.setInterval(refresh, 15_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const blocked = data.opportunities.filter((opportunity) => !opportunity.risk.approved || !opportunity.compliance.approved);
  const approved = data.opportunities.filter((opportunity) => opportunity.risk.approved && opportunity.compliance.approved);
  const activePods = data.pods.filter((pod) => pod.lifecycleStatus === "active" || pod.lifecycleStatus === "pip" || pod.lifecycleStatus === "defense");
  const stressedPods = data.pods.filter((pod) => pod.lifecycleStatus === "pip" || pod.lifecycleStatus === "defense");
  const filteredMarkets = useMemo(() => {
    const query = normalizeFilter(marketFilter);
    if (!query) return data.markets;
    return data.markets.filter((market) => searchableMarketText(market).includes(query));
  }, [data.markets, marketFilter]);
  const rankedOpportunities = useMemo(() => [...data.opportunities].sort((a, b) => b.rankScore - a.rankScore), [data.opportunities]);
  const filteredOpportunities = useMemo(() => {
    const query = normalizeFilter(opportunityFilter);
    if (!query) return rankedOpportunities;
    return rankedOpportunities.filter((opportunity) => searchableOpportunityText(opportunity).includes(query));
  }, [opportunityFilter, rankedOpportunities]);
  const navItems: Array<[string, LucideIcon, string]> = [
    ["Command", SquareActivity, "command-top"],
    ["Markets", BarChart3, "markets-panel"],
    ["Strategies", CircuitBoard, "agents-panel"],
    ["Execution", Activity, "execution-panel"],
    ["Risk", ShieldAlert, "risk-panel"],
    ["Ledger", WalletCards, "ledger-panel"],
    ["Audit", ClipboardCheck, "execution-panel"],
    ["Policy", Gauge, "policy-panel"],
    ["Settings", Gauge, "settings-panel"]
  ];
  const scrollToSection = (targetId: string) => {
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <Providers>
    <main id="command-top" className="min-h-screen bg-[#eef1f5] text-ink">
      <EventFundCopilotActions data={data} />
      <div className="grid min-h-screen grid-cols-[220px_1fr]">
        <aside className="border-r border-line bg-white">
          <div className="border-b border-line px-4 py-4">
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">EventFund OS</div>
            <div className="mt-1 text-lg font-semibold">Command Center</div>
          </div>
          <nav className="space-y-1 px-3 py-4 text-sm">
            {navItems.map(([label, Icon, targetId]) => (
              <button
                key={String(label)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-slate-700 hover:bg-slate-100"
                onClick={() => scrollToSection(targetId)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-col">
          <header className="flex items-center justify-between border-b border-line bg-white px-5 py-3">
            <div className="flex items-center gap-3">
              <StatusPill tone={data.mode === "paper" ? "info" : "danger"}>{data.mode.toUpperCase()} MODE</StatusPill>
              <StatusPill tone={data.marketSource === "kalshi" && !data.marketBlocker ? "success" : "warning"}>
                Kalshi market data: {data.marketSource}
              </StatusPill>
              <StatusPill tone={blocked.length ? "warning" : "success"}>{blocked.length} blocked</StatusPill>
              <StatusPill tone="neutral">Refresh {new Date(lastRefresh).toLocaleTimeString()}</StatusPill>
            </div>
            <button className="inline-flex items-center gap-2 rounded-md border border-danger bg-danger px-3 py-2 text-sm font-semibold text-white">
              <StopCircle className="h-4 w-4" />
              Kill Switch Armed
            </button>
          </header>

          <div id="ledger-panel" className="scroll-mt-4 grid grid-cols-9 gap-3 border-b border-line bg-panel px-5 py-4">
            <Metric label="Net Liq" value={`$${data.portfolio.netLiquidationValue.toLocaleString()}`} />
            <Metric label="Total P&L" value={`$${data.portfolio.totalPnl.toLocaleString()}`} tone={data.portfolio.totalPnl >= 0 ? "positive" : "negative"} />
            <Metric label="Unrealized" value={`$${data.portfolio.unrealizedPnl.toLocaleString()}`} tone={data.portfolio.unrealizedPnl >= 0 ? "positive" : "negative"} />
            <Metric label="Realized" value={`$${data.portfolio.realizedPnl.toLocaleString()}`} tone={data.portfolio.realizedPnl >= 0 ? "positive" : "negative"} />
            <Metric label="Settled" value={`$${data.portfolio.settledPnl.toLocaleString()}`} tone={data.portfolio.settledPnl >= 0 ? "positive" : "negative"} />
            <Metric label="Open Exposure" value={`$${data.portfolio.openExposure.toLocaleString()}`} />
            <Metric label="Candidates" value={String(approved.length)} />
            <Metric label="Pods" value={String(data.pods.length)} />
            <Metric label="Active/PIP" value={`${activePods.length}/${stressedPods.length}`} tone={stressedPods.length ? "negative" : undefined} />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[1.25fr_1.15fr_0.85fr] gap-4 p-5">
            <Panel title="Kalshi Market Watchlist" icon={<Landmark className="h-4 w-4" />} id="markets-panel">
              {data.marketBlocker ? (
                <div className="mb-3 rounded-md border border-warning bg-amber-50 p-3 text-xs leading-5 text-warning">
                  {data.marketBlocker}
                </div>
              ) : null}
              <FilterInput
                label="Filter markets"
                value={marketFilter}
                onChange={setMarketFilter}
                resultCount={filteredMarkets.length}
                totalCount={data.markets.length}
              />
              <div className="mt-3 max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {filteredMarkets.length ? filteredMarkets.map((market) => (
                  <MarketCard
                    key={market.id}
                    expanded={expandedMarketId === market.id}
                    market={market}
                    onToggle={() => setExpandedMarketId((current) => current === market.id ? undefined : market.id)}
                  />
                )) : (
                  <div className="rounded-md border border-dashed border-line p-3 text-xs text-slate-500">
                    No markets match the current filter.
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="Opportunity Ranking" icon={<BookOpenCheck className="h-4 w-4" />} id="opportunities-panel">
              <FilterInput
                label="Filter opportunities"
                value={opportunityFilter}
                onChange={setOpportunityFilter}
                resultCount={filteredOpportunities.length}
                totalCount={data.opportunities.length}
              />
              <div className="mt-3 max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {filteredOpportunities.length ? filteredOpportunities.map((opportunity, index) => (
                  <OpportunityCard
                    key={opportunity.id}
                    expanded={expandedOpportunityId === opportunity.id}
                    opportunity={opportunity}
                    rank={index + 1}
                    onToggle={() => setExpandedOpportunityId((current) => current === opportunity.id ? undefined : opportunity.id)}
                  />
                )) : (
                    <div className="rounded-md border border-dashed border-line p-3 text-xs text-slate-500">
                      {data.opportunities.length ? "No opportunities match the current filter." : "No paper-trade candidates until real Kalshi market data loads and passes risk/compliance."}
                    </div>
                )}
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel title="Risk & Compliance" icon={<ShieldAlert className="h-4 w-4" />} id="risk-panel">
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span>Mode</span>
                    <StatusPill tone="info">Paper default</StatusPill>
                  </div>
                  <div className="flex justify-between">
                    <span>Global kill switch</span>
                    <StatusPill tone="success">false required</StatusPill>
                  </div>
                  <div className="flex justify-between">
                    <span>Blocked trades</span>
                    <span className="font-mono">{blocked.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Compliance policy</span>
                    <span className="font-mono text-xs">2026-06-06</span>
                  </div>
                </div>
              </Panel>

              <Panel title="Integration Status" icon={<AlertTriangle className="h-4 w-4" />} id="settings-panel">
                <div className="space-y-3">
                  {data.integrationStatus.map((status) => (
                    <IntegrationRow key={status.name} status={status} />
                  ))}
                </div>
              </Panel>

              <Panel title="Agent Operating Policy" icon={<Gauge className="h-4 w-4" />} id="policy-panel">
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span>Policy file</span>
                    <span className="max-w-[220px] truncate font-mono text-slate-600">{data.policySummary.configPath}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Version</span>
                    <span className="font-mono text-slate-600">{data.policySummary.version}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Editable sections</span>
                    <span className="font-mono text-slate-600">{data.policySummary.editableSections.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Role policies</span>
                    <span className="font-mono text-slate-600">{data.policySummary.agentPolicyCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sector rules</span>
                    <span className="font-mono text-slate-600">{data.policySummary.sectorRuleCount}</span>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-600">
                    Agents can edit {data.policySummary.editableSections.join(", ")} through permissioned actions. Live gates,
                    secrets, kill switch state, and hard compliance rails stay protected.
                  </div>
                </div>
              </Panel>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_1fr] gap-4 px-5 pb-5">
            <Panel title="Trading Agent Swarm" icon={<CircuitBoard className="h-4 w-4" />} id="agents-panel">
              <div className="mb-4 grid grid-cols-5 gap-2">
                {data.fundAgents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {data.pods.map((pod) => (
                  <PodCard key={pod.id} pod={pod} />
                ))}
              </div>
            </Panel>

            <Panel title="Research Pipeline & Pod Governance" icon={<SquareActivity className="h-4 w-4" />}>
              <GovernancePanel scouts={data.researchScouts} proposals={data.podProposals} reviews={data.executiveReviews} />
            </Panel>

            <Panel title="Execution Tape & Audit" icon={<ClipboardCheck className="h-4 w-4" />} id="execution-panel">
              <div className="space-y-2 text-sm">
                {data.activity.map((event) => (
                  <div key={event.id} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
                    <div>
                      <div className="font-medium">{event.actor}</div>
                      <div className="text-slate-600">{event.message}</div>
                    </div>
                    <div className="whitespace-nowrap font-mono text-xs text-slate-500">{new Date(event.createdAt).toLocaleTimeString()}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Portfolio, P&L & Calibration" icon={<WalletCards className="h-4 w-4" />}>
              <PortfolioPanel portfolio={data.portfolio} />
            </Panel>
          </div>
        </section>
      </div>
    </main>
    </Providers>
  );
}

function PodCard({ pod }: { pod: SectorPod }) {
  const tone = pod.lifecycleStatus === "active"
    ? "success"
    : pod.lifecycleStatus === "pip" || pod.lifecycleStatus === "incubating"
      ? "warning"
      : pod.lifecycleStatus === "defense"
        ? "danger"
        : pod.lifecycleStatus === "sleeping"
          ? "neutral"
          : "info";
  return (
    <div className="rounded-md border border-line bg-white p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold uppercase">{pod.sector}</div>
          <div className="mt-1 text-slate-600">{pod.mandate.executiveSummary}</div>
        </div>
        <StatusPill tone={tone}>{pod.lifecycleStatus}</StatusPill>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2">
        <Cell label="Analysts" value={`${pod.mandate.analystCount}/${pod.mandate.targetAnalystCount}`} />
        <Cell label="Score" value={String(pod.mandate.mandateScore)} />
        <Cell label="PnL" value={`$${pod.mandate.totalPnl}`} />
        <Cell label="Markets" value={String(pod.activeMarkets)} />
        <Cell label="Approved" value={String(pod.approvedCandidates)} />
      </div>
      <div className="mt-2 border-t border-slate-100 pt-2 text-slate-600">{pod.mandate.thesis}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-slate-500">
        <div>Review: {new Date(pod.mandate.nextReviewAt).toLocaleTimeString()}</div>
        <div>Cadence: {pod.mandate.reviewCadence}</div>
      </div>
      {pod.mandate.requiredDefense.length ? (
        <div className="mt-2 rounded-md border border-warning/30 bg-amber-50 p-2 text-warning">
          Defense required: {pod.mandate.requiredDefense.join(", ")}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1">
        {pod.mandate.actions.slice(0, 3).map((action) => (
          <span key={action} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
            {action}
          </span>
        ))}
      </div>
    </div>
  );
}

function GovernancePanel({
  scouts,
  proposals,
  reviews
}: {
  scouts: ResearchScout[];
  proposals: PodProposal[];
  reviews: ExecutiveReview[];
}) {
  return (
    <div className="space-y-4 text-xs">
      <div>
        <div className="mb-2 font-semibold text-slate-700">Research scouts</div>
        <div className="grid grid-cols-2 gap-2">
          {scouts.slice(0, 6).map((scout) => (
            <div key={scout.id} className="rounded-md border border-line bg-slate-50 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{scout.focus}</span>
                <StatusPill tone={scout.status === "proposing" ? "success" : scout.status === "investigating" ? "info" : "neutral"}>
                  {scout.status}
                </StatusPill>
              </div>
              <div className="mt-1 text-slate-600">{scout.lastFinding}</div>
              {scout.sleepUntil ? <div className="mt-1 font-mono text-[11px] text-slate-500">wake {new Date(scout.sleepUntil).toLocaleTimeString()}</div> : null}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 font-semibold text-slate-700">Pod proposals</div>
        {proposals.slice(0, 4).map((proposal) => (
          <div key={proposal.id} className="mb-2 rounded-md border border-line p-2 last:mb-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{proposal.title}</span>
              <StatusPill tone={proposal.status === "proposed" || proposal.status === "incubating" ? "warning" : "neutral"}>
                {proposal.status}
              </StatusPill>
            </div>
            <div className="mt-1 text-slate-600">{proposal.rationale}</div>
            <div className="mt-1 font-mono text-[11px] text-slate-500">
              conf {(proposal.confidence * 100).toFixed(0)}% | analysts {proposal.requiredAnalysts} | markets {proposal.marketCount}
            </div>
          </div>
        ))}
        {proposals.length === 0 ? <div className="text-slate-500">No new pod proposals; scouts with no mandate are sleeping.</div> : null}
      </div>
      <div>
        <div className="mb-2 font-semibold text-slate-700">Executive reviews</div>
        {reviews.slice(0, 3).map((review) => (
          <div key={review.id} className="mb-2 rounded-md border border-danger/20 bg-rose-50 p-2 last:mb-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{review.sector}</span>
              <StatusPill tone={review.status === "defense" ? "danger" : "warning"}>{review.status}</StatusPill>
            </div>
            <div className="mt-1 text-slate-700">{review.decision}</div>
            <div className="mt-1 text-slate-600">{review.questions[0]}</div>
          </div>
        ))}
        {reviews.length === 0 ? <div className="text-slate-500">No pods currently on PIP or defense.</div> : null}
      </div>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  resultCount,
  totalCount
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
  totalCount: number;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-line bg-slate-50 px-3 py-2 text-xs">
      <Search className="h-4 w-4 text-slate-400" />
      <input
        className="min-w-0 flex-1 bg-transparent text-slate-800 outline-none placeholder:text-slate-400"
        placeholder={label}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="whitespace-nowrap font-mono text-[11px] text-slate-500">
        {resultCount}/{totalCount}
      </span>
    </label>
  );
}

function MarketCard({ market, expanded, onToggle }: { market: Market; expanded: boolean; onToggle: () => void }) {
  const spread = Math.max(0, market.yesAsk - market.yesBid);
  return (
    <div className="rounded-md border border-line bg-white text-xs shadow-sm">
      <button
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-slate-50"
        onClick={onToggle}
        type="button"
      >
        <span className="mt-0.5 text-slate-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-semibold text-slate-800">{market.title}</span>
          <span className="mt-1 block truncate font-mono text-[11px] text-slate-500">{market.ticker}</span>
        </span>
        <span className="grid w-[150px] shrink-0 grid-cols-2 gap-2 text-right">
          <span>
            <span className="block text-slate-500">Yes</span>
            <span className="font-mono font-semibold">{market.yesBid}/{market.yesAsk}</span>
          </span>
          <span>
            <span className="block text-slate-500">Liq</span>
            <span className="font-mono font-semibold">{compactNumber(market.liquidity)}</span>
          </span>
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-slate-100 px-3 py-3">
          <div className="grid grid-cols-3 gap-2">
            <Cell label="Sector" value={market.sector} />
            <Cell label="Status" value={market.status} />
            <Cell label="Ends" value={timeToCloseLabel(market.closeTime)} />
            <Cell label="Spread" value={`${spread}c`} />
            <Cell label="Volume" value={compactNumber(market.volume)} />
            <Cell label="Open int" value={compactNumber(market.openInterest)} />
          </div>
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-600">
            <div className="font-semibold text-slate-700">Rules</div>
            <div className="mt-1">{market.ruleSummary || "Rules summary unavailable."}</div>
          </div>
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-600">
            <div className="font-semibold text-slate-700">Settlement</div>
            <div className="mt-1">{market.settlementSource || "Settlement source unavailable."}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OpportunityCard({
  opportunity,
  expanded,
  rank,
  onToggle
}: {
  opportunity: Opportunity;
  expanded: boolean;
  rank: number;
  onToggle: () => void;
}) {
  const approved = opportunity.risk.approved && opportunity.compliance.approved;
  const directionalEdge = Math.abs(opportunity.forecast.expectedValue);
  return (
    <div className="rounded-md border border-line bg-white text-xs shadow-sm">
      <button
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-slate-50"
        onClick={onToggle}
        type="button"
      >
        <span className="mt-0.5 text-slate-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 font-mono text-[11px] font-semibold text-slate-600">
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-semibold text-slate-800">{opportunity.market.title}</span>
          <span className="mt-1 block truncate font-mono text-[11px] text-slate-500">{opportunity.market.ticker}</span>
        </span>
        <span className="grid w-[170px] shrink-0 grid-cols-3 gap-2 text-right">
          <span>
            <span className="block text-slate-500">Side</span>
            <span className="font-mono font-semibold">{opportunity.side.toUpperCase()}</span>
          </span>
          <span>
            <span className="block text-slate-500">Edge</span>
            <span className="font-mono font-semibold">{(directionalEdge * 100).toFixed(1)}</span>
          </span>
          <span>
            <span className="block text-slate-500">Ends</span>
            <span className="font-mono font-semibold">{timeToCloseLabel(opportunity.market.closeTime)}</span>
          </span>
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-slate-100 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[11px] text-slate-500">{opportunity.id}</div>
              <div className="mt-2 text-slate-600">{opportunity.thesis.summary}</div>
            </div>
            <StatusPill tone={approved ? "success" : "warning"}>{approved ? "paper ready" : "blocked"}</StatusPill>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
            <Cell label="Conf" value={`${(opportunity.forecast.confidence * 100).toFixed(0)}%`} />
            <Cell label="Mkt prob" value={`${(opportunity.forecast.marketProbability * 100).toFixed(1)}%`} />
            <Cell label="Fair" value={`${(opportunity.forecast.fairProbability * 100).toFixed(1)}%`} />
            <Cell label="Risk" value={String(opportunity.risk.riskScore)} />
            <Cell label="Size" value={`$${opportunity.risk.positionSize}`} />
            <Cell label="Rank" value={opportunity.rankScore.toFixed(1)} />
          </div>
          {opportunity.browserResearch ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-white p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-700">Browser research</span>
                <StatusPill
                  tone={
                    opportunity.browserResearch.status === "complete"
                      ? "success"
                      : opportunity.browserResearch.status === "partial"
                        ? "info"
                        : "warning"
                  }
                >
                  {opportunity.browserResearch.status}
                </StatusPill>
              </div>
              <div className="mt-2 text-slate-600">{opportunity.browserResearch.fairPricingNote}</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Cell label="Sources" value={String(opportunity.browserResearch.sources.length)} />
                <Cell label="Odds" value={String(opportunity.browserResearch.sportsbookComparisons.length)} />
                <Cell
                  label="Book prob"
                  value={
                    opportunity.browserResearch.sportsbookConsensusProbability === undefined
                      ? "n/a"
                      : `${(opportunity.browserResearch.sportsbookConsensusProbability * 100).toFixed(1)}%`
                  }
                />
              </div>
            </div>
          ) : null}
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-700">Risk negotiation</span>
              <StatusPill tone={opportunity.risk.counterOffer.accepted ? "success" : opportunity.risk.hardBlockedBy.length ? "danger" : "warning"}>
                {opportunity.risk.counterOffer.accepted ? "accepted" : opportunity.risk.hardBlockedBy.length ? "hard stop" : "countered"}
              </StatusPill>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Cell label="Risk size" value={`$${opportunity.risk.counterOffer.positionSize}`} />
              <Cell label="Max entry" value={`${opportunity.risk.counterOffer.maxEntryPrice}c`} />
              <Cell label="Max spread" value={`${opportunity.risk.counterOffer.maxSpreadBps}bps`} />
            </div>
            {opportunity.risk.counterOffer.conditions.length ? (
              <div className="mt-2 text-slate-600">{opportunity.risk.counterOffer.conditions[0]}</div>
            ) : null}
            {opportunity.risk.negotiation.length ? (
              <div className="mt-2 space-y-1">
                {opportunity.risk.negotiation.slice(-2).map((turn, index) => (
                  <div key={`${opportunity.id}-risk-turn-${index}`} className="border-t border-slate-200 pt-1 text-slate-600">
                    <span className="font-medium text-slate-700">{turn.agent}:</span> {turn.message}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PortfolioPanel({ portfolio }: { portfolio: PortfolioSnapshot }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-4 gap-2">
        <Cell label="Open" value={String(portfolio.positions.length)} />
        <Cell label="Orders" value={String(portfolio.orders.length)} />
        <Cell label="Settled" value={String(portfolio.settlements.length)} />
        <Cell label="Brier" value={portfolio.calibration.settledTrades ? portfolio.calibration.brierScore.toFixed(3) : "n/a"} />
      </div>
      <div className="overflow-auto">
        <table className="w-full text-left">
          <thead className="border-b border-line text-slate-500">
            <tr>
              <th className="py-1 pr-2">Ticker</th>
              <th className="py-1 pr-2">Side</th>
              <th className="py-1 pr-2">Qty</th>
              <th className="py-1 pr-2">Avg</th>
              <th className="py-1 pr-2">Mark</th>
              <th className="py-1 pr-2">Unrl</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.positions.slice(0, 8).map((position) => {
              const side = position.yesContracts > 0 ? "YES" : "NO";
              const quantity = position.yesContracts + position.noContracts;
              return (
                <tr key={position.ticker} className="border-b border-slate-100">
                  <td className="max-w-[180px] truncate py-1 pr-2 font-mono">{position.ticker}</td>
                  <td className="py-1 pr-2">{side}</td>
                  <td className="py-1 pr-2 font-mono">{quantity}</td>
                  <td className="py-1 pr-2 font-mono">{Math.round(position.avgCost * 100)}c</td>
                  <td className="py-1 pr-2 font-mono">{Math.round(position.markPrice * 100)}c</td>
                  <td className={`py-1 pr-2 font-mono ${position.unrealizedPnl >= 0 ? "text-healthy" : "text-danger"}`}>
                    ${position.unrealizedPnl.toLocaleString()}
                  </td>
                </tr>
              );
            })}
            {portfolio.positions.length === 0 ? (
              <tr>
                <td className="py-2 text-slate-500" colSpan={6}>No open paper positions.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-100 pt-2">
        <div className="mb-1 font-semibold text-slate-700">Latest settlements</div>
        {portfolio.settlements.slice(0, 3).map((settlement) => (
          <div key={settlement.id} className="flex justify-between gap-2 border-b border-slate-100 py-1 last:border-b-0">
            <span className="truncate font-mono">{settlement.ticker}</span>
            <span>
              {settlement.outcome.toUpperCase()} ${settlement.realizedPnl.toLocaleString()}
            </span>
          </div>
        ))}
        {portfolio.settlements.length === 0 ? <div className="text-slate-500">No settled paper outcomes yet.</div> : null}
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentNode }) {
  return (
    <div className="rounded-md border border-line bg-slate-50 p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-800">{agent.name}</div>
          <div className="font-mono text-[11px] text-slate-500">{agent.operatingMode ?? "debate"}</div>
        </div>
        <StatusPill tone={agentStatusTone(agent.status)}>
          {agent.status}
        </StatusPill>
      </div>
      <div className="mt-2 line-clamp-2 text-slate-600">{agent.systemPrompt}</div>
      <div className="mt-2 border-t border-slate-200 pt-2 text-slate-500">
        {(agent.decisionRights ?? []).slice(0, 2).join(" | ")}
      </div>
    </div>
  );
}

function agentStatusTone(status: AgentNode["status"]): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "running" || status === "complete") return "success";
  if (status === "pip") return "warning";
  if (status === "blocked") return "danger";
  if (status === "sleeping") return "neutral";
  return "info";
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`metric-number mt-1 font-mono text-xl font-semibold ${tone === "positive" ? "text-healthy" : tone === "negative" ? "text-danger" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function Panel({ title, icon, children, id }: { title: string; icon: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="min-h-0 scroll-mt-4 rounded-md border border-line bg-white">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function timeToCloseLabel(closeTime?: string): string {
  if (!closeTime) return "n/a";
  const ms = Date.parse(closeTime) - Date.now();
  if (!Number.isFinite(ms)) return "n/a";
  if (ms <= 0) return "closed";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function compactNumber(value: number): string {
  return Intl.NumberFormat("en", { maximumFractionDigits: 1, notation: "compact" }).format(value);
}

function normalizeFilter(value: string): string {
  return value.trim().toLowerCase();
}

function searchableMarketText(market: Market): string {
  return normalizeFilter([
    market.title,
    market.ticker,
    market.eventTicker,
    market.category,
    market.sector,
    market.status,
    market.ruleSummary,
    market.settlementSource
  ].filter(Boolean).join(" "));
}

function searchableOpportunityText(opportunity: Opportunity): string {
  return normalizeFilter([
    opportunity.id,
    opportunity.side,
    opportunity.market.title,
    opportunity.market.ticker,
    opportunity.market.sector,
    opportunity.thesis.summary,
    opportunity.thesis.bullCase.join(" "),
    opportunity.thesis.bearCase.join(" "),
    opportunity.risk.approved ? "risk approved" : "risk blocked",
    opportunity.compliance.approved ? "compliance approved" : "compliance blocked",
    opportunity.browserResearch?.status
  ].filter(Boolean).join(" "));
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="font-mono font-semibold">{value}</div>
    </div>
  );
}

function IntegrationRow({ status }: { status: IntegrationStatus }) {
  const tone = status.state === "complete" ? "success" : status.state === "degraded" ? "warning" : "danger";
  return (
    <div className="border-b border-slate-100 pb-2 text-sm last:border-b-0">
      <div className="flex items-center justify-between">
        <span className="font-medium">{status.name}</span>
        <StatusPill tone={tone}>{status.state}</StatusPill>
      </div>
      <div className="mt-1 text-xs text-slate-600">{status.detail}</div>
    </div>
  );
}
