import express from 'express';
import { createCoordination } from './coordination.js';
import { answerCommand, initialState, runCommittee } from './agents.js';
import { TraceRecorder, traceEvent } from './tracing.js';

const app = express();
app.use(express.json());
const port = Number(process.env.PORT ?? 8787);
const coordination = await createCoordination();
await coordination.init();
const tracer = new TraceRecorder();
const boot = initialState();
boot.integrations.redis = coordination.mode;
boot.integrations.weave = tracer.mode;
await coordination.setState(boot);

async function emit(event: ReturnType<typeof traceEvent>) {
  await tracer.record(event);
  await coordination.appendTrace(event);
}

app.get('/api/state', async (_req, res) => res.json(await coordination.getState()));
app.get('/api/health', (_req, res) => res.json({ ok: true, redis: coordination.mode, weave: tracer.mode, liveTradingEnabled: process.env.ENABLE_LIVE_TRADING === 'true' }));

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  const unsub = coordination.subscribe(event => res.write(`data: ${JSON.stringify(event)}\n\n`));
  req.on('close', unsub);
});

app.post('/api/run', async (req, res) => {
  const mandate = String(req.body?.mandate || 'Find attractive Kalshi prediction market opportunities and build a risk-aware paper portfolio.');
  let state = await coordination.getState() ?? initialState();
  state.status = 'running';
  state.traces = [];
  state.recommendations = [];
  state.portfolio = initialState().portfolio;
  await coordination.setState(state);
  runCommittee(mandate, emit, { redis: coordination.mode, weave: tracer.mode }).then(async finalState => {
    const withTraces = await coordination.getState();
    finalState.traces = withTraces?.traces ?? [];
    await coordination.setState(finalState);
    await emit(traceEvent('System', 'trace', 'Committee run completed and state persisted.'));
  }).catch(async error => {
    await emit(traceEvent('System', 'risk', `Committee run failed: ${error instanceof Error ? error.message : String(error)}`));
  });
  res.json({ ok: true, status: 'running' });
});

app.post('/api/command', async (req, res) => {
  const prompt = String(req.body?.prompt || '');
  const state = await coordination.getState() ?? initialState();
  const answer = answerCommand(state, prompt);
  await emit(traceEvent('System', 'command', `Command sidebar answered: ${prompt}`, { answer }));
  res.json({ answer });
});

app.listen(port, () => console.log(`EventFund OS API listening on http://localhost:${port}`));
