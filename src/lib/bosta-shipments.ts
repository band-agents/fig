import 'server-only';
// FIG parcels in Egypt with Bosta, the same way Labesny's go with UPS Kuwait: the delivery is booked as soon
// as an order is ready to pick, terminated with the order, and Bosta's scans move the order on: picked up →
// shipped (the store emails Bosta's tracking link), out for delivery, delivered or refused.
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL } from './channels';
import { moveOrder, flagException, record, type Actor } from './engine';
import { publish } from './bus';
import { forbidden, invalid, notFound } from './errors';
import { can, seesChannel } from './domain/perms';
import { isAllowed, ORDER_FLOW, type OrderStage } from './domain/stages';
import { BOSTA_COURIER, bostaCollected, bostaConfigured, bostaCreateAt, bostaEnv, bostaTrackingUrl, classifyBosta, createDelivery, terminateDelivery, trackDeliveries } from './connectors';

const BOSTA: Actor = { id: null, name: 'Bosta', dept: null };

type OrderRow = typeof schema.orders.$inferSelect;

/** The stores Bosta ships for: FIG's website and app unless BOSTA_CHANNELS names others (comma list). */
export const bostaChannels = () => (process.env.BOSTA_CHANNELS?.trim() || 'fig-web,fig-app').split(',').map((s) => s.trim()).filter(Boolean);
export const shipsWithBosta = (o: Pick<OrderRow, 'channelId' | 'address'>) => bostaChannels().includes(o.channelId) && CHANNEL[o.channelId]?.country === 'EG' && (o.address?.country ?? 'EG').toUpperCase() === 'EG';
const isBosta = (o: Pick<OrderRow, 'courier' | 'tracking'>) => o.courier === BOSTA_COURIER && Boolean(o.tracking);

/** Books the order's Bosta delivery and keeps the tracking number on the order. A person or the system. */
export async function createBostaShipment(actor: Actor, orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound('Order not found.');
  if (actor.principal && (!seesChannel(actor.principal, o.channelId) || !can(actor.principal, 'shipping', 2))) throw forbidden('Booking a courier needs Shipping access.');
  if (!shipsWithBosta(o)) throw invalid('Bosta only ships FIG orders inside Egypt.');
  if (!bostaConfigured('EG')) throw invalid('Bosta is not set up yet.');
  if (o.source === 'demo') throw invalid('Demo orders are never booked with a real courier.');
  if (['cancelled', 'settled', 'rto', 'rto_closed', 'delivered'].includes(o.stage)) throw invalid('This order is closed.');
  if (isBosta(o)) throw invalid(`Already booked with Bosta: ${o.tracking}.`);
  if (o.tracking) throw invalid(`This order already has a waybill (${o.courier ?? 'courier'} ${o.tracking}).`);
  const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));
  const { tracking } = await createDelivery({ ...o, lines });
  const at = new Date();
  await db.update(schema.orders).set({ courier: BOSTA_COURIER, tracking, trackingUrl: bostaTrackingUrl(tracking), exception: null, updatedAt: at }).where(eq(schema.orders.id, o.id));
  await record({ orderId: o.id, at, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'courier', message: `Bosta delivery ${tracking} booked${bostaEnv() === 'staging' ? ' · Bosta test account' : ''}`, data: { courier: BOSTA_COURIER, waybill: tracking, env: bostaEnv() } });
  publish({ kind: 'order', id: o.id, number: o.number, channelId: o.channelId, actor: actor.name, message: `${o.number} booked with Bosta ${tracking}` });
  return tracking;
}

/**
 * The engine calls this after every stage change (never awaited, never allowed to stop an order):
 * book at the configured stage, terminate the delivery when the order is cancelled.
 */
export async function bostaFollowsOrder(orderId: string, to: OrderStage) {
  if (!bostaConfigured('EG')) return;
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o || !shipsWithBosta(o) || o.source === 'demo') return;
  try {
    if (to === 'cancelled' && isBosta(o)) {
      await terminateDelivery(o.tracking!);
      await record({ orderId: o.id, at: new Date(), actorId: null, actorName: BOSTA.name, dept: null, kind: 'courier', message: `Bosta delivery ${o.tracking} cancelled with the order` });
      return;
    }
    const at = bostaCreateAt();
    // a courier the team assigned wins: an order given to Aramex or Mylerz is never booked with Bosta
    const chosen = o.courier && o.courier !== CHANNEL[o.channelId]?.carrier ? o.courier : null; // the store's default carrier is no choice
    if (at !== 'manual' && to === at && !o.tracking && (!chosen || chosen === BOSTA_COURIER)) await createBostaShipment({ ...BOSTA, name: 'System' }, o.id);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (to === 'cancelled') await record({ orderId: o.id, at: new Date(), actorId: null, actorName: BOSTA.name, dept: null, kind: 'courier', message: `Bosta delivery ${o.tracking} NOT cancelled: ${why}` });
    else await flagException(BOSTA, o.id, `Bosta booking failed: ${why}`.slice(0, 240)).catch(() => {});
  }
}

/** Walks an order forward to shipped one allowed step at a time (a parcel collected before the floor marked it packed). */
async function walkToShipped(o: OrderRow, at: Date) {
  const paths: Record<string, OrderStage[]> = { ready: ['picking', 'packed', 'shipped'], picking: ['packed', 'shipped'], packed: ['shipped'] };
  for (const s of paths[o.stage] ?? []) await moveOrder(BOSTA, o.id, s, s === 'shipped' ? { tracking: o.tracking!, courier: BOSTA_COURIER, trackingUrl: o.trackingUrl ?? bostaTrackingUrl(o.tracking!), note: 'Picked up by Bosta' } : {}, { at });
}

/** Asks Bosta about every booked FIG parcel and moves orders when the courier says so. */
export async function trackBosta() {
  if (!bostaConfigured('EG')) return { ok: false, note: 'Bosta is not configured' };
  const db = await getDb();
  const open = await db
    .select()
    .from(schema.orders)
    .where(and(inArray(schema.orders.stage, ['ready', 'picking', 'packed', 'shipped', 'delivering']), eq(schema.orders.courier, BOSTA_COURIER), isNotNull(schema.orders.tracking), ne(schema.orders.source, 'demo')));
  if (!open.length) return { ok: true, note: 'No Bosta parcels open' };
  const answers = await trackDeliveries(open.map((o) => o.tracking!));
  let moved = 0;
  for (const o of open) {
    const a = answers.get(o.tracking!);
    if (!a?.code) continue;
    const last = a.updates.at(-1);
    const when = last?.at ?? new Date();
    const cls = classifyBosta(a.code, a.type);
    try {
      if (cls === 'cancelled' || cls === 'awaiting' || cls === 'info') continue;
      if (['ready', 'picking', 'packed'].includes(o.stage)) {
        // shipped only once the driver has it: a scan before the pickup is not a collection (#1155)
        if (!bostaCollected(a.code)) continue;
        const collected = a.updates.find((u) => bostaCollected(Number(u.code)))?.at ?? when;
        await walkToShipped(o, collected);
        moved++;
        if (cls === 'picked_up') continue;
        const [now] = await db.select({ stage: schema.orders.stage }).from(schema.orders).where(eq(schema.orders.id, o.id));
        o.stage = now?.stage ?? o.stage;
      }
      if (cls === 'delivered') {
        await moveOrder(BOSTA, o.id, 'delivered', {}, { at: when });
        moved++;
      } else if (cls === 'out_for_delivery' && o.stage === 'shipped') {
        await moveOrder(BOSTA, o.id, 'delivering', {}, { at: when });
        moved++;
      } else if (cls === 'returned' && isAllowed(ORDER_FLOW, o.stage as OrderStage, 'rto')) {
        await moveOrder(BOSTA, o.id, 'rto', { reason: last?.comment || last?.description || 'Returned by Bosta' }, { at: when });
        moved++;
      } else if (cls === 'exception') {
        const msg = `${last?.description ?? 'Exception'}${last?.comment ? ` · ${last.comment}` : ''}`;
        if (o.exception !== msg) await flagException(BOSTA, o.id, msg, { attempt: /attempt|not in the address|not answering|postpone|retry/i.test(msg) });
      }
    } catch {
      // a stage rule refused the move (on hold, say); the next run tries again
    }
  }
  return { ok: true, note: `${open.length} Bosta parcels checked · ${moved} moved` };
}
