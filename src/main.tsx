import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, AlertTriangle, Bot, Briefcase, CheckCircle2, FileText, Gauge, LineChart, Lock, MessageSquare, Play, Shield, Sparkles, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import './styles.css';

type Rec = any;
type State = any;
const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

function money(cents: number) { return `$${(cents / 100).toFixed(2)}`; }
function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

function useAppState() {
  const [state, setState] = useState<State | null>(null);
  async function refresh() { const res = await fetch(`${API}/api/state`); setState(await res.json()); }
  useEffect(() => {
    refresh();
    const es = new EventSource(`${API}/api/events`);
    es.onmessage = () => refresh();
    const id = setInterval(refresh, 2500);
    return () => { es.close(); clearInterval(id); };
  }, []);
  return { state, refresh };
}

function Badge({ children, tone = 'blue' }: { children: React.ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }

function App() {
  const { state, refresh } = useAppState();
  const [mandate, setMandate] = useState('Find attractive Kalshi prediction market opportunities and build a risk-aware paper portfolio.');
  const [prompt, setPrompt] = useState('Why did the agents recommend this market?');
  const [answer, setAnswer] = useState('');
  const [selected, setSelected] = useState<Rec | null>(null);

  const recs: Rec[] = state?.recommendations ?? [];
  useEffect(() => { if (!selected && recs.length) setSelected(recs[0]); }, [recs.length]);
  const exposure = useMemo(() => Object.entries(state?.portfolio?.exposureByCategory ?? {}).map(([name, value]) => ({ name, value })), [state]);
  const edgeData = recs.map(r => ({ id: r.market.id.replace('KX', ''), edge: Number((r.edge * 100).toFixed(1)), risk: r.riskScore }));

  async function run() {
    await fetch(`${API}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mandate }) });
    await refresh();
  }
  async function ask() {
    const res = await fetch(`${API}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
    setAnswer((await res.json()).answer);
    await refresh();
  }

  return <main>
    <header className="hero">
      <div>
        <div className="eyebrow"><Sparkles size={16}/> EventFund OS · paper-trading investment committee</div>
        <h1>Kalshi-style prediction market command center</h1>
        <p>Multi-agent market scanning, fair-value estimation, adversarial debate, risk/compliance gating, paper execution, and memo generation. The human is the CIO; agents are analysts.</p>
      </div>
      <div className="safety"><Lock/><strong>Paper trading only</strong><span>ENABLE_LIVE_TRADING is ignored by the UI unless future explicit human confirmation is added.</span></div>
    </header>

    <section className="mandate card glow">
      <textarea value={mandate} onChange={e => setMandate(e.target.value)} />
      <button onClick={run} disabled={state?.status === 'running'}><Play size={18}/>{state?.status === 'running' ? 'Committee running…' : 'Run investment committee'}</button>
    </section>

    <section className="grid kpis">
      <div className="card"><Briefcase/><span>Paper notional</span><strong>{money(state?.portfolio?.totalNotionalCents ?? 0)}</strong></div>
      <div className="card"><Gauge/><span>Open paper positions</span><strong>{state?.portfolio?.positions?.length ?? 0}</strong></div>
      <div className="card"><Shield/><span>Compliance mode</span><strong>Human supervised</strong></div>
      <div className="card"><Activity/><span>Coordination</span><strong>{state?.integrations?.redis ?? 'fallback-memory'}</strong></div>
    </section>

    <section className="layout">
      <div className="leftcol">
        <section className="card">
          <h2><Bot/> Agent swarm live room</h2>
          <div className="agents">
            {['CEO','Product','Scanner','Interpreter','Research','Quant','Contrarian','Risk','Compliance','Execution','QA','Demo'].map((a, i) => <div className="agent" key={a}><span>{a}</span><Badge tone={state?.status === 'running' ? 'yellow' : i < 10 ? 'green' : 'blue'}>{state?.status === 'idle' ? 'ready' : 'active'}</Badge></div>)}
          </div>
          <div className="timeline">{(state?.traces ?? []).slice(0, 18).map((t: any) => <div className="trace" key={t.id}><Badge tone={t.type === 'risk' ? 'red' : t.type === 'trade' ? 'green' : 'blue'}>{t.agent}</Badge><p>{t.message}</p><time>{new Date(t.ts).toLocaleTimeString()}</time></div>)}</div>
        </section>

        <section className="card">
          <h2><LineChart/> Market opportunities</h2>
          <table><thead><tr><th>Market</th><th>Px</th><th>Fair</th><th>Edge</th><th>Risk</th><th>Action</th></tr></thead><tbody>{recs.map(r => <tr key={r.market.id} onClick={() => setSelected(r)} className={selected?.market?.id === r.market.id ? 'sel' : ''}><td><strong>{r.market.id}</strong><small>{r.market.title}</small></td><td>{r.market.yesPrice}¢</td><td>{pct(r.fairProbability)}</td><td className={r.edge > 0 ? 'pos' : 'neg'}>{(r.edge*100).toFixed(1)}pp</td><td>{r.riskScore}</td><td><Badge tone={r.recommendation.startsWith('BUY') ? 'green' : r.recommendation === 'BLOCKED' ? 'red' : 'yellow'}>{r.recommendation}</Badge></td></tr>)}</tbody></table>
        </section>
      </div>

      <aside className="rightcol">
        <section className="card command">
          <h2><MessageSquare/> Copilot-style command sidebar</h2>
          <input value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()} />
          <div className="quick"><button onClick={() => setPrompt('Show only low-risk trades')}>Low-risk</button><button onClick={() => setPrompt('Reduce exposure to politics markets')}>Reduce politics</button><button onClick={() => setPrompt('Generate the investment memo')}>Memo</button></div>
          <button onClick={ask}><Zap size={16}/> Ask command center</button>
          {answer && <pre>{answer}</pre>}
        </section>

        <section className="card">
          <h2><AlertTriangle/> Risk dashboard</h2>
          <ResponsiveContainer width="100%" height={180}><BarChart data={edgeData}><CartesianGrid strokeDasharray="3 3" stroke="#26324f"/><XAxis dataKey="id" hide/><YAxis/><Tooltip/><Bar dataKey="edge" fill="#60a5fa"/><Bar dataKey="risk" fill="#f59e0b"/></BarChart></ResponsiveContainer>
          <div className="risknotes"><Badge>Max drawdown {money(state?.portfolio?.maxDrawdownLimitCents ?? 15000)}</Badge><Badge tone="red">Not financial advice</Badge></div>
        </section>

        <section className="card">
          <h2><Briefcase/> Paper portfolio</h2>
          {(state?.portfolio?.positions ?? []).map((p: any) => <div className="position" key={p.id}><strong>{p.side} · {p.marketId}</strong><span>{p.shares} @ {p.avgPrice}¢ · {money(p.notionalCents)}</span></div>)}
          {exposure.length > 0 && <ResponsiveContainer width="100%" height={150}><PieChart><Pie data={exposure} dataKey="value" nameKey="name" outerRadius={62}>{exposure.map((_, i) => <Cell key={i} fill={['#38bdf8','#22c55e','#f59e0b','#a78bfa'][i%4]}/>)}</Pie><Tooltip formatter={(v) => money(Number(v ?? 0))}/></PieChart></ResponsiveContainer>}
        </section>
      </aside>
    </section>

    <section className="layout bottom">
      <section className="card detail">
        <h2><CheckCircle2/> Selected investment thesis</h2>
        {selected ? <><h3>{selected.market.title}</h3><p>{selected.thesis}</p><h4>Contract interpretation</h4><p>{selected.interpretedContract}</p><h4>Evidence ({selected.evidence.simulated ? 'simulated/public fallback' : 'live'})</h4><ul>{selected.evidence.bullets.map((b: string) => <li key={b}>{b}</li>)}</ul><h4>Debate</h4>{selected.debate.map((d: any) => <div className="debate" key={d.agent+d.message}><Badge tone={d.stance === 'challenge' ? 'red' : d.stance === 'approve' ? 'green' : 'blue'}>{d.agent}</Badge><span>{d.message}</span></div>)}</> : <p>Run the committee to populate details.</p>}
      </section>
      <section className="card memo">
        <h2><FileText/> Investment memo</h2>
        <pre>{state?.memo || 'Run the committee to generate a memo.'}</pre>
      </section>
    </section>

    <footer>Integrations: Redis {state?.integrations?.redis}; Weave {state?.integrations?.weave}; Kalshi {state?.integrations?.kalshi}; CopilotKit fallback command sidebar. Mock markets are clearly marked.</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
