import { runCommittee } from '../server/agents.js';

const events: string[] = [];
const state = await runCommittee('Smoke test mandate', async e => { events.push(e.message); }, { redis: 'fallback-memory', weave: 'fallback-local-traces' });
if (state.status !== 'complete') throw new Error('committee did not complete');
if (!state.recommendations.length) throw new Error('no recommendations generated');
if (!state.memo.includes('paper')) throw new Error('memo missing safety language');
console.log(JSON.stringify({ ok: true, recommendations: state.recommendations.length, paperPositions: state.portfolio.positions.length, events: events.length }, null, 2));
