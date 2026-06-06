import { appendFile, mkdir } from 'node:fs/promises';
import type { TraceEvent } from './types.js';

export class TraceRecorder {
  mode: 'fallback-local-traces' | 'configured-placeholder';
  constructor() {
    this.mode = process.env.WEAVE_API_KEY || process.env.WANDB_API_KEY ? 'configured-placeholder' : 'fallback-local-traces';
  }
  async record(event: TraceEvent) {
    await mkdir('.eventfund-traces', { recursive: true });
    await appendFile('.eventfund-traces/agent-traces.jsonl', `${JSON.stringify(event)}\n`);
  }
}

export function traceEvent(agent: TraceEvent['agent'], type: TraceEvent['type'], message: string, payload?: unknown): TraceEvent {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ts: new Date().toISOString(), agent, type, message, payload };
}
