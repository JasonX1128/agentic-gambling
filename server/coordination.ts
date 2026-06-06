import { EventEmitter } from 'node:events';
import type { AppState, TraceEvent } from './types.js';

type Listener = (event: TraceEvent) => void;

export interface CoordinationLayer {
  mode: 'connected' | 'fallback-memory';
  init(): Promise<void>;
  getState(): Promise<AppState | undefined>;
  setState(state: AppState): Promise<void>;
  appendTrace(event: TraceEvent): Promise<void>;
  subscribe(listener: Listener): () => void;
}

export class MemoryCoordination implements CoordinationLayer {
  mode: 'fallback-memory' = 'fallback-memory';
  private state?: AppState;
  private emitter = new EventEmitter();
  async init() {}
  async getState() { return this.state; }
  async setState(state: AppState) { this.state = state; }
  async appendTrace(event: TraceEvent) {
    if (this.state) this.state.traces = [event, ...this.state.traces].slice(0, 250);
    this.emitter.emit('trace', event);
  }
  subscribe(listener: Listener) {
    this.emitter.on('trace', listener);
    return () => this.emitter.off('trace', listener);
  }
}

export async function createCoordination(): Promise<CoordinationLayer> {
  if (!process.env.REDIS_URL) return new MemoryCoordination();
  try {
    const { createClient } = await import('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    const mem = new MemoryCoordination();
    return {
      mode: 'connected',
      async init() {},
      async getState() {
        const raw = await client.get('eventfund:state');
        return raw ? JSON.parse(raw) as AppState : undefined;
      },
      async setState(state) {
        await client.set('eventfund:state', JSON.stringify(state));
        await mem.setState(state);
      },
      async appendTrace(event) {
        await client.xAdd('eventfund:agent_stream', '*', { event: JSON.stringify(event) });
        await client.publish('eventfund:live', JSON.stringify(event));
        const raw = await client.get('eventfund:state');
        const state = raw ? JSON.parse(raw) as AppState : undefined;
        if (state) {
          state.traces = [event, ...state.traces].slice(0, 250);
          await client.set('eventfund:state', JSON.stringify(state));
          await mem.setState(state);
        }
        await mem.appendTrace(event);
      },
      subscribe(listener) { return mem.subscribe(listener); }
    };
  } catch {
    return new MemoryCoordination();
  }
}
