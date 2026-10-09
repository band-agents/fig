import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL, channelConfigured } from './channels';
import type { WriteBackChange } from './connectors/types';

// Telling the store what happened in Relay (fulfilment + tracking, COD marked paid, a relay:<stage> tag).
// Off unless RELAY_WRITE_BACK=true, never blocks the floor, and every attempt lands on the timeline.

export const writeBackEnabled = () => process.env.RELAY_WRITE_BACK === 'true';

export function queueWriteBack(orderId: string, stage: string, input: { tracking?: string; courier?: string; trackingUrl?: string }) {
  if (!writeBackEnabled()) return;
  setTimeout(() => {
    void push(orderId, stage, input).catch((e) => console.error('[relay] write-back failed', orderId, stage, e instanceof Error ? e.message : e));
  }, 0);
}

async function push(orderId: string, stage: string, input: { tracking?: string; courier?: string; trackingUrl?: string }) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o || o.source === 'demo') return;
  const channel = CHANNEL[o.channelId];
  if (!channel || !channelConfigured(channel)) return;
  const { connectorFor } = await import('./connectors');
  const connector = connectorFor(channel);
  if (!connector?.writeBack) return;
  const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));

  const changes: WriteBackChange[] = [{ kind: 'stage_tag', stage }];
  if (stage === 'shipped' && (input.tracking ?? o.tracking)) {
    changes.push({ kind: 'fulfil', tracking: input.tracking ?? o.tracking!, company: input.courier ?? o.courier ?? channel.carrier, url: input.trackingUrl ?? o.trackingUrl, notifyCustomer: true });
  }
  if (stage === 'settled' && o.paymentMethod === 'cod') changes.push({ kind: 'mark_paid' });

  const done: Record<string, string> = { ...(o.writeBack ?? {}) };
  for (const change of changes) {
    const res = await connector.writeBack({ ...channel }, { ...o, lines }, change);
    if (res.skipped) continue;
    done[change.kind === 'stage_tag' ? `tag:${stage}` : change.kind] = res.ok ? new Date().toISOString() : `failed: ${res.note}`;
    await db.insert(schema.events).values({
      orderId,
      actorName: channel.name,
      kind: 'sync',
      message: res.ok ? `Store updated · ${res.note}` : `Store update failed · ${res.note}`,
      data: { change: change.kind },
    });
  }
  await db.update(schema.orders).set({ writeBack: done }).where(eq(schema.orders.id, orderId));
}
