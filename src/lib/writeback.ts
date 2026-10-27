import 'server-only';
import { keepAlive } from './keep-alive';
import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL, channelConfigured, storeWriteBack } from './channels';
import type { WriteBackChange } from './connectors/types';
import type { Order } from './db/schema';
import { changesForStage, type StageInput } from './domain/store-changes';

export { changesForStage };

// Telling the store what happened in the console (Dan, 24 Oct: "when we take action here it affects
// Shopify directly"). Off unless RELAY_WRITE_BACK=true; =dry reads the store and records what it
// would send without sending. It never blocks the floor: changes go out right after the action, one
// order at a time, and every attempt lands on the order's timeline. Never for demo orders.
//
// What each action does in the store (Dan's choices, 24 Oct): every stage is tagged relay:<stage>;
// a hold holds the fulfilment; handing to the courier fulfils with tracking and emails the customer;
// out for delivery, delivered and refused are steps on the shipment; settling cash marks it paid;
// cancelling cancels and restocks with no refund (Finance refunds a paid order deliberately); a
// return refunded goes back the way the customer chose (card, store credit, cash at a store).
// Stock and prices are never written: Lucida keeps those in Shopify.

export type WriteBackMode = 'live' | 'dry' | 'off';
/** The console-wide switch, or one store's (a read-only store, or its own RELAY_<PREFIX>_WRITE_BACK). */
export const writeBackMode = (channelId?: string): WriteBackMode => {
  const c = channelId ? CHANNEL[channelId] : undefined;
  if (c) return storeWriteBack(c);
  return process.env.RELAY_WRITE_BACK === 'true' ? 'live' : process.env.RELAY_WRITE_BACK === 'dry' ? 'dry' : 'off';
};
export const writeBackEnabled = () => writeBackMode() !== 'off';

/**
 * Changes that must never go twice (a fulfilment, a cancel, a refund): once one succeeded, it is not
 * sent again, whatever replays. Tags and holds can repeat; the store side checks those anyway.
 */
const onceKey = (c: WriteBackChange) =>
  c.kind === 'fulfil' ? 'fulfil' : c.kind === 'mark_paid' ? 'mark_paid' : c.kind === 'cancel' ? 'cancel' : c.kind === 'refund' ? `refund:${c.returnNumber}` : c.kind === 'refund_order' ? 'refund_order' : c.kind === 'delivery' ? `delivery:${c.status}` : null;
const doneKey = (c: WriteBackChange) => onceKey(c) ?? (c.kind === 'stage_tag' ? `tag:${c.stage}` : c.kind);

/** After a stage move made in the console (or by Autopilot): the stage's changes. */
export function queueWriteBack(orderId: string, stage: string, input: StageInput) {
  queue(orderId, (o, carrier) => changesForStage(o, stage, input, carrier));
}

/** Any other change: a hold, a release, a refund. */
export function queueStoreChanges(orderId: string, changes: WriteBackChange[]) {
  queue(orderId, () => changes);
}

// one order at a time, in the order the floor acted, so two quick moves cannot race each other's tags
const chains = new Map<string, Promise<void>>();

function queue(orderId: string, build: (o: Order, carrier: string) => WriteBackChange[]) {
  // whether this order's store takes changes is decided per store in push (a read-only store, or its own switch)
  const prev = chains.get(orderId) ?? Promise.resolve();
  const next = prev
    .then(() => push(orderId, build))
    .catch((e) => console.error('[relay] write-back failed', orderId, e instanceof Error ? e.message : e));
  chains.set(orderId, next);
  keepAlive(next);
  void next.finally(() => chains.get(orderId) === next && chains.delete(orderId));
}

async function push(orderId: string, build: (o: Order, carrier: string) => WriteBackChange[]) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o || o.source === 'demo') return;
  const channel = CHANNEL[o.channelId];
  if (!channel || !channelConfigured(channel)) return;
  const { connectorFor } = await import('./connectors');
  const connector = connectorFor(channel);
  if (!connector?.writeBack) return;
  const mode = writeBackMode(o.channelId);
  if (mode === 'off') return;
  const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  const dry = mode === 'dry';

  const done: Record<string, string> = { ...(o.writeBack ?? {}) };
  for (const change of build(o, channel.carrier)) {
    const once = onceKey(change);
    // already done for real: a retry or a replay sends nothing
    if (once && done[once] && !done[once].startsWith('failed') && !done[once].startsWith('dry')) continue;
    const res = await connector.writeBack({ ...channel }, { ...o, lines }, change);
    if (res.skipped && !res.ok) continue;
    done[doneKey(change)] = res.ok ? (dry ? `dry ${new Date().toISOString()}` : new Date().toISOString()) : `failed: ${res.note}`;
    await db.insert(schema.events).values({
      orderId,
      actorName: channel.name,
      kind: 'sync',
      message: res.ok ? `Shopify · ${res.note}` : `Shopify failed · ${res.note}`,
      data: { change: change.kind, ...(dry ? { dry: true } : {}), ...(res.ok ? {} : { failed: true }) },
    });
  }
  await db.update(schema.orders).set({ writeBack: done }).where(eq(schema.orders.id, orderId));
}

/** The changes on an order that failed last time, to send again (the order page's Retry). */
export function failedChanges(writeBack: Record<string, string> | null | undefined) {
  return Object.entries(writeBack ?? {})
    .filter(([, v]) => v.startsWith('failed'))
    .map(([k, v]) => ({ key: k, why: v.replace(/^failed:\s*/, '') }));
}

/**
 * What Retry sends: the failed changes, and once write-back is live, the ones only recorded during the
 * dry run (25 Oct: an order cancelled while dry stayed open on Shopify, and Retry said "Nothing failed").
 */
export function changesToResend(writeBack: Record<string, string> | null | undefined, channelId?: string) {
  // a stage tag from the dry run is history (the order has moved on), not something Shopify is missing
  const unsent = writeBackMode(channelId) === 'live' ? Object.entries(writeBack ?? {}).filter(([k, v]) => v.startsWith('dry') && !k.startsWith('tag:')) : [];
  return { failed: failedChanges(writeBack), unsent: unsent.map(([k]) => k) };
}
