"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  CircuitBoard,
  ClipboardCheck,
  Gauge,
  Landmark,
  ShieldAlert,
  SquareActivity,
  StopCircle,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DemoRun, IntegrationStatus, Opportunity } from "@/lib/domain";
import { StatusPill } from "@/components/ui/StatusPill";
import { EventFundCopilotActions } from "@/components/copilot/EventFundCopilotActions";
import { Providers } from "@/app/providers";

export function CommandCenter({ initialData }: { initialData: DemoRun }) {
  const data = initialData;
  const blocked = data.opportunities.filter((opportunity) => !opportunity.risk.approved || !opportunity.compliance.approved);
  const approved = data.opportunities.filter((opportunity) => opportunity.risk.approved && opportunity.compliance.approved);
  const navItems: Array<[string, LucideIcon, string]> = [
    ["Command", SquareActivity, "command-top"],
    ["Markets", BarChart3, "markets-panel"],
    ["Strategies", CircuitBoard, "agents-panel"],
    ["Execution", Activity, "execution-panel"],
    ["Risk", ShieldAlert, "risk-panel"],
    ["Ledger", WalletCards, "ledger-panel"],
    ["Audit", ClipboardCheck, "execution-panel"],
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
            </div>
            <button className="inline-flex items-center gap-2 rounded-md border border-danger bg-danger px-3 py-2 text-sm font-semibold text-white">
              <StopCircle className="h-4 w-4" />
              Kill Switch Armed
            </button>
          </header>

          <div id="ledger-panel" className="scroll-mt-4 grid grid-cols-6 gap-3 border-b border-line bg-panel px-5 py-4">
            <Metric label="Net Liq" value={`$${data.portfolio.netLiquidationValue.toLocaleString()}`} />
            <Metric label="Daily P&L" value={`$${data.portfolio.dailyPnl.toLocaleString()}`} tone={data.portfolio.dailyPnl >= 0 ? "positive" : "negative"} />
            <Metric label="Open Exposure" value={`$${data.portfolio.openExposure.toLocaleString()}`} />
            <Metric label="Available" value={`$${data.portfolio.availableCapital.toLocaleString()}`} />
            <Metric label="Candidates" value={String(approved.length)} />
            <Metric label="Active Pods" value={String(data.pods.length)} />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[1.25fr_1.15fr_0.85fr] gap-4 p-5">
            <Panel title="Kalshi Market Watchlist" icon={<Landmark className="h-4 w-4" />} id="markets-panel">
              {data.marketBlocker ? (
                <div className="mb-3 rounded-md border border-warning bg-amber-50 p-3 text-xs leading-5 text-warning">
                  {data.marketBlocker}
                </div>
              ) : null}
              <div className="overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-line text-slate-500">
                    <tr>
                      <th className="py-2 pr-2">Market</th>
                      <th className="py-2 pr-2">Sector</th>
                      <th className="py-2 pr-2">Yes</th>
                      <th className="py-2 pr-2">Spread</th>
                      <th className="py-2 pr-2">Liq</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.markets.length ? data.markets.map((market) => (
                      <tr key={market.id} className="border-b border-slate-100 align-top">
                        <td className="max-w-[300px] py-2 pr-2">
                          <div className="font-medium">{market.title}</div>
                          <div className="font-mono text-[11px] text-slate-500">{market.ticker}</div>
                        </td>
                        <td className="py-2 pr-2">{market.sector}</td>
                        <td className="py-2 pr-2 font-mono">
                          {market.yesBid}/{market.yesAsk}
                        </td>
                        <td className="py-2 pr-2 font-mono">{Math.max(0, market.yesAsk - market.yesBid)}</td>
                        <td className="py-2 pr-2 font-mono">{market.liquidity}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td className="py-4 pr-2 text-slate-500" colSpan={5}>
                          No real Kalshi markets loaded.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Opportunity Ranking" icon={<BookOpenCheck className="h-4 w-4" />}>
              <div className="space-y-3">
                {data.opportunities.length ? data.opportunities
                  .sort((a, b) => b.rankScore - a.rankScore)
                  .map((opportunity) => (
                    <OpportunityRow key={opportunity.id} opportunity={opportunity} />
                  )) : (
                    <div className="rounded-md border border-dashed border-line p-3 text-xs text-slate-500">
                      No paper-trade candidates until real Kalshi market data loads and passes risk/compliance.
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
            </div>
          </div>

          <div className="grid grid-cols-[1fr_1fr] gap-4 px-5 pb-5">
            <Panel title="Trading Agent Swarm" icon={<CircuitBoard className="h-4 w-4" />} id="agents-panel">
              <div className="grid grid-cols-3 gap-3">
                {data.pods.map((pod) => (
                  <div key={pod.id} className="rounded-md border border-line bg-white p-3">
                    <div className="font-semibold uppercase">{pod.sector}</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="font-mono">{pod.activeMarkets}</div>
                        <div className="text-slate-500">markets</div>
                      </div>
                      <div>
                        <div className="font-mono">{pod.approvedCandidates}</div>
                        <div className="text-slate-500">approved</div>
                      </div>
                      <div>
                        <div className="font-mono">{pod.blockedTrades}</div>
                        <div className="text-slate-500">blocked</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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
          </div>
        </section>
      </div>
    </main>
    </Providers>
  );
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

function OpportunityRow({ opportunity }: { opportunity: Opportunity }) {
  const approved = opportunity.risk.approved && opportunity.compliance.approved;
  return (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{opportunity.market.title}</div>
          <div className="mt-1 font-mono text-xs text-slate-500">{opportunity.id}</div>
        </div>
        <StatusPill tone={approved ? "success" : "warning"}>{approved ? "paper ready" : "blocked"}</StatusPill>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2 text-xs">
        <Cell label="Side" value={opportunity.side.toUpperCase()} />
        <Cell label="EV" value={`${(opportunity.forecast.expectedValue * 100).toFixed(1)}pt`} />
        <Cell label="Conf" value={`${(opportunity.forecast.confidence * 100).toFixed(0)}%`} />
        <Cell label="Risk" value={String(opportunity.risk.riskScore)} />
        <Cell label="Size" value={`$${opportunity.risk.positionSize}`} />
      </div>
      <div className="mt-2 text-xs text-slate-600">{opportunity.thesis.summary}</div>
    </div>
  );
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
