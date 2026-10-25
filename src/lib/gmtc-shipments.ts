import 'server-only';
// Kuwait parcels with UPS (GMTC): the consignment is booked as soon as an order is ready to pick (Dan,
// 25 Oct: "the shipment is created by itself"), cancelled with the order, and GMTC's scans move the order
// on: collected → shipped (the store emails the waybill), out for delivery, delivered or refused.
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL } from './channels';
import { moveOrder, flagException, record, type Actor } from './engine';
import { publish } from './bus';
import { forbidden, invalid, notFound } from './errors';
import { can, seesChannel } from './domain/perms';
import { isAllowed, ORDER_FLOW, type OrderStage } from './domain/stages';
import { cancelConsignment, classifyGmtc, createConsignment, GMTC_COURIER, gmtcConfigured, gmtcCreateAt, gmtcEnv, trackConsignments } from './connectors';

const UPS: Actor = { id: null, name: 'UPS (GMTC)', dept: null };

type OrderRow = typeof schema.orders.$inferSelect;

const kuwait = (o: Pick<OrderRow, 'channelId'>) => CHANNEL[o.channelId]?.country === 'KW';
const isUps = (o: Pick<OrderRow, 'courier' | 'tracking'>) => o.courier === GMTC_COURIER && Boolean(o.tracking);
const label = (service: string) => service.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Books the order's UPS consignment and keeps the waybill on the order. A person or the system. */
export async function createUpsShipment(actor: Actor, orderId: string, opts: { service?: string } = {}) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound('Order not found.');
  if (actor.principal && (!seesChannel(actor.principal, o.channelId) || !can(actor.principal, 'shipping', 2))) throw forbidden('Booking a courier needs Shipping access.');
  if (!kuwait(o)) throw invalid('UPS (GMTC) only ships inside Kuwait.');
  if (!gmtcConfigured('KW')) throw invalid('UPS (GMTC) is not set up yet.');
  if (o.source === 'demo') throw invalid('Demo orders are never booked with a real courier.');
  if (['cancelled', 'settled', 'rto', 'rto_closed', 'delivered'].includes(o.stage)) throw invalid('This order is closed.');
  if (isUps(o)) throw invalid(`Already booked with UPS: ${o.tracking}.`);
  if (o.tracking) throw invalid(`This order already has a waybill (${o.courier ?? 'courier'} ${o.tracking}).`);
  const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));
  const { waybill, service } = await createConsignment({ ...o, lines }, opts);
  const at = new Date();
  await db.update(schema.orders).set({ courier: GMTC_COURIER, tracking: waybill, trackingUrl: null, exception: null, updatedAt: at }).where(eq(schema.orders.id, o.id));
  await record({ orderId: o.id, at, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'courier', message: `UPS shipment ${waybill} booked · ${label(service)}${gmtcEnv() === 'staging' ? ' · GMTC test account' : ''}`, data: { courier: GMTC_COURIER, waybill, service, env: gmtcEnv() } });
  publish({ kind: 'order', id: o.id, number: o.number, channelId: o.channelId, actor: actor.name, message: `${o.number} booked with UPS ${waybill}` });
  return waybill;
}

/**
 * The engine calls this after every stage change (never awaited, never allowed to stop an order):
 * book at the configured stage, cancel the consignment when the order is cancelled.
 */
export async function courierFollowsOrder(orderId: string, to: OrderStage) {
  if (!gmtcConfigured('KW')) return;
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o || !kuwait(o) || o.source === 'demo') return;
  try {
    if (to === 'cancelled' && isUps(o)) {
      await cancelConsignment(o.tracking!);
      await record({ orderId: o.id, at: new Date(), actorId: null, actorName: UPS.name, dept: null, kind: 'courier', message: `UPS shipment ${o.tracking} cancelled with the order` });
      return;
    }
    const at = gmtcCreateAt();
    // a courier the team assigned wins: an order given to Aramex is never booked with UPS
    const chosen = o.courier && o.courier !== CHANNEL[o.channelId]?.carrier ? o.courier : null; // the store's default carrier is no choice
    if (at !== 'manual' && to === at && !o.tracking && (!chosen || chosen === GMTC_COURIER)) await createUpsShipment({ ...UPS, name: 'System' }, o.id);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // a failed booking is flagged on the order (which also writes the timeline); a failed cancel only needs the line
    if (to === 'cancelled') await record({ orderId: o.id, at: new Date(), actorId: null, actorName: UPS.name, dept: null, kind: 'courier', message: `UPS shipment ${o.tracking} NOT cancelled: ${why}` });
    else await flagException(UPS, o.id, `UPS booking failed: ${why}`.slice(0, 240)).catch(() => {});
  }
}

/** Walks an order forward to `to` one allowed step at a time (a parcel collected before the floor marked it packed). */
async function walkTo(o: OrderRow, to: OrderStage, at: Date, note?: string) {
  const paths: Record<string, OrderStage[]> = { ready: ['picking', 'packed', 'shipped'], picking: ['packed', 'shipped'], packed: ['shipped'] };
  const path = paths[o.stage] ?? [];
  const steps = to === 'shipped' ? path : [];
  for (const s of steps) await moveOrder(UPS, o.id, s, s === 'shipped' ? { tracking: o.tracking!, courier: GMTC_COURIER, note } : {}, { at });
}

/** Asks GMTC about every booked Kuwait parcel and moves orders when the courier says so. */
export async function trackUps() {
  if (!gmtcConfigured('KW')) return { ok: false, note: 'UPS (GMTC) is not configured' };
  const db = await getDb();
  const open = await db
    .select()
    .from(schema.orders)
    .where(and(inArray(schema.orders.stage, ['ready', 'picking', 'packed', 'shipped', 'delivering']), eq(schema.orders.courier, GMTC_COURIER), isNotNull(schema.orders.tracking), ne(schema.orders.source, 'demo')));
  if (!open.length) return { ok: true, note: 'No UPS parcels open' };
  const answers = await trackConsignments(open.map((o) => o.tracking!));
  let moved = 0;
  for (const o of open) {
    const a = answers.get(o.tracking!);
    if (!a?.status) continue;
    const last = a.updates.at(-1);
    const when = last?.at ?? new Date();
    const cls = classifyGmtc(a.status);
    try {
      if (cls === 'cancelled' || cls === 'awaiting' || cls === 'info') continue;
      if (['ready', 'picking', 'packed'].includes(o.stage)) {
        // anything past "awaiting pickup" means GMTC has the parcel
        await walkTo(o, 'shipped', when, 'Collected by UPS');
        moved++;
        if (cls === 'picked_up' || cls === 'in_transit') continue;
        const [now] = await db.select({ stage: schema.orders.stage }).from(schema.orders).where(eq(schema.orders.id, o.id));
        o.stage = now?.stage ?? o.stage;
      }
      if (cls === 'delivered') {
        await moveOrder(UPS, o.id, 'delivered', {}, { at: when });
        moved++;
      } else if (cls === 'out_for_delivery' && o.stage === 'shipped') {
        await moveOrder(UPS, o.id, 'delivering', {}, { at: when });
        moved++;
      } else if (cls === 'returned' && isAllowed(ORDER_FLOW, o.stage as OrderStage, 'rto')) {
        await moveOrder(UPS, o.id, 'rto', { reason: last?.comment || last?.description || 'Returned by UPS' }, { at: when });
        moved++;
      } else if (cls === 'exception') {
        const msg = `${last?.description ?? a.status}${last?.comment ? ` · ${last.comment}` : ''}`;
        if (o.exception !== msg) await flagException(UPS, o.id, msg, { attempt: /attempt|undeliver|not home|unable/i.test(msg) });
      }
    } catch {
      // a stage rule refused the move (on hold, say); the next run tries again
    }
  }
  return { ok: true, note: `${open.length} UPS parcels checked · ${moved} moved` };
}
