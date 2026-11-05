import 'server-only';
// FIG parcels in Egypt with Aramex, beside Bosta: the team books either one from Shipping, and EG_AUTO_COURIER
// says which one books an order by itself when it reaches Ready. Aramex's scans then move the order: collected →
// shipped (the store emails the tracking link); from there sync.ts's Aramex tracking takes it to delivered or RTO.
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL } from './channels';
import { moveOrder, record, flagException, type Actor } from './engine';
import { publish } from './bus';
import { forbidden, invalid, notFound } from './errors';
import { can, seesChannel } from './domain/perms';
import type { OrderStage } from './domain/stages';
import { shipsWithBosta } from './bosta-shipments';
import { ARAMEX_COURIER, aramexBookingConfigured, aramexCollected, aramexCreateAt, aramexEnv, aramexTrackingUrl, createShipment, egyptAutoCourier, trackShipments } from './connectors';

const ARAMEX: Actor = { id: null, name: 'Aramex', dept: null };

type OrderRow = typeof schema.orders.$inferSelect;

/** Aramex ships the same orders Bosta does: FIG's stores, inside Egypt. */
export const shipsWithAramex = shipsWithBosta;
const isAramex = (o: Pick<OrderRow, 'courier' | 'tracking'>) => o.courier === ARAMEX_COURIER && Boolean(o.tracking);

/** Books the order with Aramex and keeps the waybill on the order. A person or the system. */
export async function createAramexShipment(actor: Actor, orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound('Order not found.');
  if (actor.principal && (!seesChannel(actor.principal, o.channelId) || !can(actor.principal, 'shipping', 2))) throw forbidden('Booking a courier needs Shipping access.');
  if (!shipsWithAramex(o)) throw invalid('Aramex is only booked for FIG orders inside Egypt.');
  if (!aramexBookingConfigured('EG')) throw invalid('Aramex booking is not set up yet.');
  if (o.source === 'demo') throw invalid('Demo orders are never booked with a real courier.');
  if (['cancelled', 'settled', 'rto', 'rto_closed', 'delivered'].includes(o.stage)) throw invalid('This order is closed.');
  if (isAramex(o)) throw invalid(`Already booked with Aramex: ${o.tracking}.`);
  if (o.tracking) throw invalid(`This order already has a waybill (${o.courier ?? 'courier'} ${o.tracking}).`);
  const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));
  const { awb } = await createShipment({ ...o, lines });
  const at = new Date();
  await db.update(schema.orders).set({ courier: ARAMEX_COURIER, tracking: awb, trackingUrl: aramexTrackingUrl(awb), exception: null, updatedAt: at }).where(eq(schema.orders.id, o.id));
  await record({ orderId: o.id, at, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'courier', message: `Aramex waybill ${awb} booked${aramexEnv() === 'uat' ? ' · Aramex test server' : ''}`, data: { courier: ARAMEX_COURIER, waybill: awb, env: aramexEnv() } });
  publish({ kind: 'order', id: o.id, number: o.number, channelId: o.channelId, actor: actor.name, message: `${o.number} booked with Aramex ${awb}` });
  return awb;
}

/**
 * The engine calls this after every stage change (never awaited, never allowed to stop an order): book at the
 * configured stage when Aramex is Egypt's automatic courier. Aramex's API cannot cancel a waybill, so a
 * cancelled order's waybill is left for the team to cancel with Aramex, and the order says so.
 */
export async function aramexFollowsOrder(orderId: string, to: OrderStage) {
  if (!aramexBookingConfigured('EG')) return;
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o || !shipsWithAramex(o) || o.source === 'demo') return;
  try {
    if (to === 'cancelled') {
      if (isAramex(o)) await record({ orderId: o.id, at: new Date(), actorId: null, actorName: ARAMEX.name, dept: null, kind: 'courier', message: `Aramex waybill ${o.tracking} is still open: cancel it with Aramex (their API cannot)` });
      return;
    }
    if (egyptAutoCourier() !== 'aramex') return;
    const at = aramexCreateAt();
    // a courier the team chose wins: an order given to Bosta is never booked with Aramex (the store's default carrier is no choice)
    const chosen = o.courier && o.courier !== CHANNEL[o.channelId]?.carrier ? o.courier : null;
    if (at !== 'manual' && to === at && !o.tracking && !chosen) await createAramexShipment({ ...ARAMEX, name: 'System' }, o.id);
  } catch (e) {
    if (to !== 'cancelled') await flagException(ARAMEX, o.id, `Aramex booking failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 240)).catch(() => {});
  }
}

/** Walks an order forward to shipped one allowed step at a time (a parcel collected before the floor marked it packed). */
async function walkToShipped(o: OrderRow, at: Date) {
  const paths: Record<string, OrderStage[]> = { ready: ['picking', 'packed', 'shipped'], picking: ['packed', 'shipped'], packed: ['shipped'] };
  for (const s of paths[o.stage] ?? []) await moveOrder(ARAMEX, o.id, s, s === 'shipped' ? { tracking: o.tracking!, courier: ARAMEX_COURIER, trackingUrl: o.trackingUrl ?? aramexTrackingUrl(o.tracking!), note: 'Collected by Aramex' } : {}, { at });
}

/**
 * Aramex parcels booked here but not yet on the road: shipped once Aramex has collected them. Once shipped,
 * the courier pass in sync.ts tracks them on to delivered, out for delivery, exceptions and RTO.
 */
export async function trackAramexPickups() {
  if (!aramexBookingConfigured('EG')) return { ok: false, note: 'Aramex booking is not configured' };
  const db = await getDb();
  const waiting = await db
    .select()
    .from(schema.orders)
    .where(and(inArray(schema.orders.stage, ['ready', 'picking', 'packed']), eq(schema.orders.courier, ARAMEX_COURIER), isNotNull(schema.orders.tracking), ne(schema.orders.source, 'demo')));
  const mine = waiting.filter(shipsWithAramex);
  if (!mine.length) return { ok: true, note: 'No Aramex parcels waiting for pickup' };
  const scans = await trackShipments(mine.map((o) => o.tracking!), 'EG');
  let moved = 0;
  for (const o of mine) {
    const first = (scans.get(o.tracking!) ?? []).find((u) => aramexCollected(u));
    if (!first) continue;
    try {
      await walkToShipped(o, first.at);
      moved++;
    } catch {
      // a stage rule refused the move (on hold, say); the next run tries again
    }
  }
  return { ok: true, note: `${mine.length} Aramex parcels waiting · ${moved} collected` };
}
