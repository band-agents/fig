import 'server-only';
// Labesny parcels leaving Kuwait with UPS international (account 2C0G62). UPS Kuwait (GMTC) keeps every
// address in Kuwait; an order whose address is in another country is booked here instead: by hand from the
// shipping desk, or by itself at UPS_INTL_CREATE_AT. The label UPS returns at booking is kept on the order's
// timeline (UPS gives it once; reprinting needs Label Recovery, which this app does not use).
import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL } from './channels';
import { moveOrder, flagException, record, type Actor } from './engine';
import { publish } from './bus';
import { forbidden, invalid, notFound } from './errors';
import { can, seesChannel } from './domain/perms';
import { isAllowed, ORDER_FLOW, type OrderStage } from './domain/stages';
import { checkDestination, classifyUpsIntl, createUpsIntlShipment, trackUpsIntl as track, UPS_INTL_COURIER, UPS_INTL_SERVICES, upsCollectedAt, upsIntlConfigured, upsIntlCreateAt, upsIntlEnv, upsTrackingUrl, voidUpsIntlShipment } from './connectors';

const UPS: Actor = { id: null, name: 'UPS', dept: null };

type OrderRow = typeof schema.orders.$inferSelect;

/** A Kuwait store's order going to an address outside Kuwait: the only orders this courier books. */
export const abroad = (o: Pick<OrderRow, 'channelId' | 'address'>) => CHANNEL[o.channelId]?.country === 'KW' && Boolean(o.address?.country) && o.address!.country.trim().toUpperCase() !== 'KW';
const isUpsIntl = (o: Pick<OrderRow, 'courier' | 'tracking'>) => o.courier === UPS_INTL_COURIER && Boolean(o.tracking);

/** Books the order with UPS international and keeps the tracking number and label. A person or the system. */
export async function createUpsIntlOrderShipment(actor: Actor, orderId: string, opts: { service?: string } = {}) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound('Order not found.');
  if (actor.principal && (!seesChannel(actor.principal, o.channelId) || !can(actor.principal, 'shipping', 2))) throw forbidden('Booking a courier needs Shipping access.');
  if (CHANNEL[o.channelId]?.country !== 'KW') throw invalid('UPS international ships Labesny (Kuwait) orders only.');
  const why = checkDestination(o.address);
  if (why) throw invalid(why);
  if (!upsIntlConfigured()) throw invalid('UPS international is not set up yet.');
  if (o.source === 'demo') throw invalid('Demo orders are never booked with a real courier.');
  if (['cancelled', 'settled', 'rto', 'rto_closed', 'delivered'].includes(o.stage)) throw invalid('This order is closed.');
  if (isUpsIntl(o)) throw invalid(`Already booked with UPS: ${o.tracking}.`);
  if (o.tracking) throw invalid(`This order already has a waybill (${o.courier ?? 'courier'} ${o.tracking}).`);
  const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));
  const s = await createUpsIntlShipment({ ...o, lines }, opts);
  const at = new Date();
  const test = upsIntlEnv() === 'test';
  await db.update(schema.orders).set({ courier: UPS_INTL_COURIER, tracking: s.tracking, trackingUrl: test ? null : upsTrackingUrl(s.tracking), exception: null, updatedAt: at }).where(eq(schema.orders.id, o.id));
  await record({
    orderId: o.id,
    at,
    actorId: actor.id,
    actorName: actor.name,
    dept: actor.dept,
    kind: 'courier',
    message: `UPS shipment ${s.tracking} booked to ${o.address!.country.toUpperCase()} · ${UPS_INTL_SERVICES[s.service] ?? s.service}${s.charge ? ` · ${s.charge}` : ''}${test ? ' · UPS test system' : ''}`,
    data: { courier: UPS_INTL_COURIER, waybill: s.tracking, shipmentId: s.shipmentId, service: s.service, charge: s.charge, env: upsIntlEnv(), label: s.label, labelFormat: s.labelFormat },
  });
  publish({ kind: 'order', id: o.id, number: o.number, channelId: o.channelId, actor: actor.name, message: `${o.number} booked with UPS ${s.tracking}` });
  return s.tracking;
}

/** The label UPS returned when the order was booked, or null. */
export async function upsIntlLabel(orderId: string): Promise<{ bytes: Uint8Array; format: string } | null> {
  const db = await getDb();
  const rows = await db
    .select({ data: schema.events.data })
    .from(schema.events)
    .where(and(eq(schema.events.orderId, orderId), eq(schema.events.kind, 'courier')))
    .orderBy(desc(schema.events.at))
    .limit(20);
  const hit = rows.map((r) => r.data as { courier?: string; label?: string; labelFormat?: string } | null).find((d) => d?.courier === UPS_INTL_COURIER && d.label);
  return hit ? { bytes: Uint8Array.from(Buffer.from(hit.label!, 'base64')), format: (hit.labelFormat ?? 'GIF').toLowerCase() } : null;
}

/** The engine calls this after every stage change (never awaited): book at the configured stage, void when cancelled. */
export async function upsIntlFollowsOrder(orderId: string, to: OrderStage) {
  if (!upsIntlConfigured()) return;
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o || !abroad(o) || o.source === 'demo') return;
  try {
    if (to === 'cancelled' && isUpsIntl(o)) {
      const [ev] = await db
        .select({ data: schema.events.data })
        .from(schema.events)
        .where(and(eq(schema.events.orderId, o.id), eq(schema.events.kind, 'courier')))
        .orderBy(desc(schema.events.at))
        .limit(1);
      await voidUpsIntlShipment(((ev?.data as { shipmentId?: string } | null)?.shipmentId) ?? o.tracking!);
      await record({ orderId: o.id, at: new Date(), actorId: null, actorName: UPS.name, dept: null, kind: 'courier', message: `UPS shipment ${o.tracking} voided with the order` });
      return;
    }
    const at = upsIntlCreateAt();
    const chosen = o.courier && o.courier !== CHANNEL[o.channelId]?.carrier ? o.courier : null; // the store's default carrier is no choice
    if (at !== 'manual' && to === at && !o.tracking && (!chosen || chosen === UPS_INTL_COURIER)) await createUpsIntlOrderShipment({ ...UPS, name: 'System' }, o.id);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (to === 'cancelled') await record({ orderId: o.id, at: new Date(), actorId: null, actorName: UPS.name, dept: null, kind: 'courier', message: `UPS shipment ${o.tracking} NOT voided: ${why}` });
    else await flagException(UPS, o.id, `UPS booking failed: ${why}`.slice(0, 240)).catch(() => {});
  }
}

async function walkTo(o: OrderRow, at: Date) {
  const paths: Record<string, OrderStage[]> = { ready: ['picking', 'packed', 'shipped'], picking: ['packed', 'shipped'], packed: ['shipped'] };
  for (const s of paths[o.stage] ?? []) await moveOrder(UPS, o.id, s, s === 'shipped' ? { tracking: o.tracking!, courier: UPS_INTL_COURIER, note: 'Collected by UPS' } : {}, { at });
}

/** Asks UPS about every open parcel abroad and moves orders when UPS says so. */
export async function trackUpsIntlOrders() {
  if (!upsIntlConfigured()) return { ok: false, note: 'UPS international is not configured' };
  const db = await getDb();
  const open = await db
    .select()
    .from(schema.orders)
    .where(and(inArray(schema.orders.stage, ['ready', 'picking', 'packed', 'shipped', 'delivering']), eq(schema.orders.courier, UPS_INTL_COURIER), isNotNull(schema.orders.tracking), ne(schema.orders.source, 'demo')));
  if (!open.length) return { ok: true, note: 'No UPS parcels abroad open' };
  const answers = await track(open.map((o) => o.tracking!));
  let moved = 0;
  for (const o of open) {
    const a = answers.get(o.tracking!);
    if (!a) continue;
    const cls = classifyUpsIntl(a.type, a.description);
    const when = a.updates.at(-1)?.at ?? new Date();
    try {
      if (cls === 'awaiting' || cls === 'info') continue;
      if (['ready', 'picking', 'packed'].includes(o.stage)) {
        const collected = upsCollectedAt(a.updates);
        if (!collected) continue;
        await walkTo(o, collected);
        moved++;
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
        await moveOrder(UPS, o.id, 'rto', { reason: a.description || 'Returned by UPS' }, { at: when });
        moved++;
      } else if (cls === 'exception') {
        const msg = a.description || 'UPS exception';
        if (o.exception !== msg) await flagException(UPS, o.id, msg, { attempt: /attempt|undeliver|not home|unable/i.test(msg) });
      }
    } catch {
      // a stage rule refused the move (on hold, say); the next run tries again
    }
  }
  return { ok: true, note: `${open.length} UPS parcels abroad checked · ${moved} moved` };
}
