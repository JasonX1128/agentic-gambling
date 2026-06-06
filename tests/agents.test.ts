import { describe, expect, it } from 'vitest';
import { answerCommand, initialState, runCommittee } from '../server/agents.js';

describe('EventFund OS committee', () => {
  it('creates only paper trades with risk and compliance notes', async () => {
    const events: unknown[] = [];
    const state = await runCommittee('Find attractive Kalshi opportunities', async e => { events.push(e); }, { redis: 'fallback-memory', weave: 'fallback-local-traces' });
    expect(state.status).toBe('complete');
    expect(state.recommendations.length).toBeGreaterThan(3);
    expect(state.portfolio.positions.every(p => p.id.startsWith('PAPER-'))).toBe(true);
    expect(state.recommendations.every(r => r.complianceNotes.some(n => n.includes('Paper trading only')))).toBe(true);
    expect(events.length).toBeGreaterThan(10);
  });

  it('answers fallback copilot commands', () => {
    const state = initialState();
    state.memo = 'memo text';
    expect(answerCommand(state, 'Generate the investment memo')).toContain('memo text');
  });
});
