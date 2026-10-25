import 'server-only';
import { EventEmitter } from 'node:events';

// In-process live bus: every stage change, note and sync lands here and fans out to open browsers over
// SSE (/api/stream). One instance per server process, which is what a single Relay deployment runs.

export type LiveEvent = {
  kind: 'order' | 'return' | 'sync' | 'presence' | 'stock';
  id?: string;
  number?: string;
  channelId?: string;
  stage?: string;
  actor?: string;
  message?: string;
  at: string;
};

const g = globalThis as unknown as { __relayBus?: EventEmitter; __relayPresence?: Map<string, { name: string; hue: number; since: number; conns: number }> };
export const bus = (g.__relayBus ??= Object.assign(new EventEmitter(), {}).setMaxListeners(500));
export const presence = (g.__relayPresence ??= new Map());

export function publish(e: Omit<LiveEvent, 'at'>) {
  bus.emit('live', { ...e, at: new Date().toISOString() } satisfies LiveEvent);
}
