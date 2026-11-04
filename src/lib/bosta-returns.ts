import 'server-only';
// Egypt returns collected by Bosta, as Kuwait's are by UPS: a customer who asks to be collected at home gets
// a Customer Return Pickup booked the moment care approves the return (Dan, 5 Nov: "we accept the return
// then Bosta gets notified automatically"). A return the customer brings to a shop is never booked.
// Declining the return terminates the pickup; Bosta's scans then move it on: picked up from the customer
// → in transit, returned to us → received. BOSTA_RETURN_AT=manual books nothing on its own.
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL } from './channels';
import { moveReturn, record, type Actor } from './engine';
import { publish } from './bus';
import { forbidden, invalid, notFound } from './errors';
import { can, seesChannel } from './domain/perms';
import type { ReturnStage } from './domain/stages';
import { BOSTA_COURIER, bostaConfigured, bostaEnv, bostaReturnAt, classifyBostaReturn, createBostaReturnPickup, terminateDelivery, trackDeliveries } from './connectors';
import { shipsWithBosta } from './bosta-shipments';

const BOSTA: Actor = { id: null, name: 'Bosta', dept: null };

type ReturnRow = typeof schema.returns.$inferSelect;

const egypt = (r: Pick<ReturnRow, 'channelId'>) => CHANNEL[r.channelId]?.country === 'EG';

/** Whether Bosta can collect this return at all: Egypt, a home pickup, Bosta switched on. */
export const bostaCollects = (r: Pick<ReturnRow, 'channelId' | 'method'>) => egypt(r) && r.method === 'pickup' && bostaConfigured('EG');

/** Books the Bosta return pickup and keeps its tracking number on the return. A person or the system. */
export async function bookBostaReturn(actor: Actor, returnId: string) {
  const db = await getDb();
  const [r] = await db.select().from(schema.returns).where(eq(schema.returns.id, returnId));
  if (!r) throw notFound('Return not found.');
  if (actor.principal && (!seesChannel(actor.principal, r.channelId) || !can(actor.principal, 'shipping', 2))) throw forbidden('Booking a courier needs Shipping access.');
  if (!egypt(r)) throw invalid('Bosta only collects inside Egypt.');
  if (r.method !== 'pickup') throw invalid('The customer is bringing this return to a shop; there is nothing to collect.');
  if (!bostaConfigured('EG')) throw invalid('Bosta is not set up yet.');
  if (r.tracking) throw invalid(`A pickup is already booked: ${r.tracking}.`);
  if (['received', 'inspected', 'refund_pending', 'refunded', 'closed', 'rejected'].includes(r.stage)) throw invalid('This return is already back or closed.');
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
  if (!o) throw notFound('Order not found.');
  if (o.source === 'demo') throw invalid('Demo returns are never booked with a real courier.');
  if (!shipsWithBosta(o)) throw invalid('Bosta only collects FIG returns inside Egypt.');
  const lines = await db
    .select({ title: schema.orderItems.title, quantity: schema.returnItems.quantity })
    .from(schema.returnItems)
    .innerJoin(schema.orderItems, eq(schema.orderItems.id, schema.returnItems.orderItemId))
    .where(eq(schema.returnItems.returnId, r.id));
  const { tracking } = await createBostaReturnPickup({ number: r.number, order: { ...o, lines: [] }, lines });
  const at = new Date();
  await db.update(schema.returns).set({ tracking }).where(eq(schema.returns.id, r.id));
  const msg = `Bosta return pickup ${tracking} booked · the driver collects ${r.number} from the customer${bostaEnv() === 'staging' ? ' · Bosta test account' : ''}`;
  await record({ orderId: r.orderId, returnId: r.id, at, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'courier', message: msg, data: { courier: BOSTA_COURIER, waybill: tracking, env: bostaEnv() } });
  publish({ kind: 'return', id: r.id, number: r.number, channelId: r.channelId, stage: r.stage, actor: actor.name, message: msg });
  return tracking;
}

/**
 * The engine calls this after a return is approved or declined (never awaited, never allowed to stop the
 * return): approved → book the pickup and take the return to "Courier pickup"; declined → terminate it.
 */
export async function bostaFollowsReturn(returnId: string, to: ReturnStage) {
  const db = await getDb();
  const [r] = await db.select().from(schema.returns).where(eq(schema.returns.id, returnId));
  if (!r || !bostaCollects(r)) return;
  try {
    if (to === 'rejected') {
      if (!r.tracking) return;
      await terminateDelivery(r.tracking);
      await record({ orderId: r.orderId, returnId: r.id, at: new Date(), actorId: null, actorName: BOSTA.name, dept: null, kind: 'courier', message: `Bosta return pickup ${r.tracking} cancelled with the return` });
      return;
    }
    if (to !== 'approved') return;
    let tracking = r.tracking;
    if (!tracking && bostaReturnAt() === 'approved') tracking = await bookBostaReturn({ ...BOSTA, name: 'System' }, r.id);
    if (tracking) await moveReturn({ ...BOSTA, name: 'System' }, r.id, 'pickup', { tracking });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const msg = to === 'rejected' ? `Bosta return pickup ${r.tracking} NOT cancelled: ${why}` : `Bosta return pickup NOT booked: ${why} · book it from the return once fixed`;
    await record({ orderId: r.orderId, returnId: r.id, at: new Date(), actorId: null, actorName: BOSTA.name, dept: null, kind: 'courier', message: msg.slice(0, 300) }).catch(() => {});
    publish({ kind: 'return', id: r.id, number: r.number, channelId: r.channelId, stage: r.stage, actor: BOSTA.name, message: `${r.number}: ${msg}`.slice(0, 300) });
  }
}

async function lastCourierLine(returnId: string) {
  const db = await getDb();
  const [e] = await db
    .select({ message: schema.events.message })
    .from(schema.events)
    .where(and(eq(schema.events.returnId, returnId), eq(schema.events.kind, 'courier')))
    .orderBy(desc(schema.events.at))
    .limit(1);
  return e?.message ?? '';
}

/** Asks Bosta about every booked return pickup and moves returns when the courier says so. */
export async function trackBostaReturns() {
  if (!bostaConfigured('EG')) return { ok: false, note: 'Bosta is not configured' };
  const db = await getDb();
  const open = (
    await db
      .select()
      .from(schema.returns)
      .where(and(inArray(schema.returns.stage, ['approved', 'pickup', 'in_transit']), eq(schema.returns.method, 'pickup'), isNotNull(schema.returns.tracking)))
  ).filter(egypt);
  if (!open.length) return { ok: true, note: 'No Bosta return pickups open' };
  const answers = await trackDeliveries(open.map((r) => r.tracking!));
  let moved = 0;
  for (const r of open) {
    const a = answers.get(r.tracking!);
    if (!a?.code) continue;
    const last = a.updates.at(-1);
    const cls = classifyBostaReturn(a.code);
    try {
      if (cls === 'exception' || cls === 'cancelled') {
        const msg = `Bosta: ${last?.description ?? `state ${a.code}`}${last?.comment ? ` · ${last.comment}` : ''}`.slice(0, 300);
        if ((await lastCourierLine(r.id)) !== msg) {
          await record({ orderId: r.orderId, returnId: r.id, at: last?.at ?? new Date(), actorId: null, actorName: BOSTA.name, dept: null, kind: 'courier', message: msg });
          publish({ kind: 'return', id: r.id, number: r.number, channelId: r.channelId, stage: r.stage, actor: BOSTA.name, message: `${r.number} · ${msg}` });
        }
        continue;
      }
      if (r.stage === 'approved') {
        await moveReturn({ ...BOSTA, name: 'System' }, r.id, 'pickup', { tracking: r.tracking! });
        r.stage = 'pickup';
        moved++;
      }
      if (cls !== 'collected' && cls !== 'received') continue;
      if (r.stage === 'pickup') {
        const collected = a.updates.find((u) => ['collected', 'received'].includes(classifyBostaReturn(Number(u.code))))?.at ?? last?.at ?? new Date();
        await moveReturn(BOSTA, r.id, 'in_transit', { note: 'Collected by Bosta' }, { at: collected });
        r.stage = 'in_transit';
        moved++;
      }
      if (cls === 'received' && r.stage === 'in_transit') {
        await moveReturn(BOSTA, r.id, 'received', { note: 'Returned to us by Bosta' }, { at: last?.at ?? new Date() });
        moved++;
      }
    } catch {
      // a stage rule refused the move; the next run tries again
    }
  }
  return { ok: true, note: `${open.length} Bosta return pickups checked · ${moved} moved` };
}
