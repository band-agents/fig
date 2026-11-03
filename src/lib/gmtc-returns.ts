import 'server-only';
// Kuwait returns collected by UPS (GMTC): a customer who asks for a pickup at home gets one booked the
// moment the return is opened (Dan, 2 Nov: "UPS has to know straight away"), so the driver is on the
// way while customer care reviews it. A return the customer brings to a shop is never booked. Declining
// the return cancels the pickup; GMTC's scans then move it on: collected → in transit, delivered to the
// warehouse → received. GMTC_RETURN_AT=approved books only once care approves; manual books nothing.
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL } from './channels';
import { moveReturn, record, type Actor } from './engine';
import { publish } from './bus';
import { forbidden, invalid, notFound } from './errors';
import { can, seesChannel } from './domain/perms';
import type { ReturnStage } from './domain/stages';
import { cancelConsignment, classifyGmtc, collectedAt, createReturnPickup, gmtcConfigured, gmtcEnv, trackConsignments } from './connectors';

const UPS: Actor = { id: null, name: 'UPS (GMTC)', dept: null };

type ReturnRow = typeof schema.returns.$inferSelect;

const kuwait = (r: Pick<ReturnRow, 'channelId'>) => CHANNEL[r.channelId]?.country === 'KW';

/** When a home pickup is booked: as soon as the return is opened (default), once approved, or never. */
export const gmtcReturnAt = (): 'requested' | 'approved' | 'manual' => {
  const v = (process.env.GMTC_RETURN_AT ?? '').trim().toLowerCase();
  return v === 'approved' || v === 'manual' ? v : 'requested';
};

/** Whether UPS can collect this return at all: Kuwait, a home pickup, UPS switched on. */
export const upsCollects = (r: Pick<ReturnRow, 'channelId' | 'method'>) => kuwait(r) && r.method === 'pickup' && gmtcConfigured('KW');

/** Books the UPS pickup for a return and keeps the waybill on it. A person or the system. */
export async function bookReturnPickup(actor: Actor, returnId: string) {
  const db = await getDb();
  const [r] = await db.select().from(schema.returns).where(eq(schema.returns.id, returnId));
  if (!r) throw notFound('Return not found.');
  if (actor.principal && (!seesChannel(actor.principal, r.channelId) || !can(actor.principal, 'shipping', 2))) throw forbidden('Booking a courier needs Shipping access.');
  if (!kuwait(r)) throw invalid('UPS (GMTC) only collects inside Kuwait.');
  if (r.method !== 'pickup') throw invalid('The customer is bringing this return to a shop; there is nothing to collect.');
  if (!gmtcConfigured('KW')) throw invalid('UPS (GMTC) is not set up yet.');
  if (r.tracking) throw invalid(`A pickup is already booked: ${r.tracking}.`);
  if (['received', 'inspected', 'refund_pending', 'refunded', 'closed', 'rejected'].includes(r.stage)) throw invalid('This return is already back or closed.');
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
  if (!o) throw notFound('Order not found.');
  if (o.source === 'demo') throw invalid('Demo returns are never booked with a real courier.');
  const lines = await db
    .select({ title: schema.orderItems.title, quantity: schema.returnItems.quantity })
    .from(schema.returnItems)
    .innerJoin(schema.orderItems, eq(schema.orderItems.id, schema.returnItems.orderItemId))
    .where(eq(schema.returnItems.returnId, r.id));
  const { waybill } = await createReturnPickup({ number: r.number, amount: Number(r.amount), currency: r.currency, order: o, lines });
  const at = new Date();
  await db.update(schema.returns).set({ tracking: waybill }).where(eq(schema.returns.id, r.id));
  const msg = `UPS pickup ${waybill} booked · the driver collects ${r.number} from the customer${gmtcEnv() === 'staging' ? ' · GMTC test account' : ''}`;
  await record({ orderId: r.orderId, returnId: r.id, at, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'courier', message: msg, data: { courier: 'UPS Kuwait', waybill, env: gmtcEnv() } });
  publish({ kind: 'return', id: r.id, number: r.number, channelId: r.channelId, stage: r.stage, actor: actor.name, message: msg });
  return waybill;
}

/**
 * The engine calls this after a return is opened and after every stage change (never awaited, never
 * allowed to stop the return): book at the configured stage, take an approved return with a booked
 * pickup straight to "Courier pickup", cancel the pickup when the return is declined.
 */
export async function courierFollowsReturn(returnId: string, to: ReturnStage) {
  const db = await getDb();
  const [r] = await db.select().from(schema.returns).where(eq(schema.returns.id, returnId));
  if (!r || !upsCollects(r)) return;
  try {
    if (to === 'rejected') {
      if (!r.tracking) return;
      await cancelConsignment(r.tracking);
      await record({ orderId: r.orderId, returnId: r.id, at: new Date(), actorId: null, actorName: UPS.name, dept: null, kind: 'courier', message: `UPS pickup ${r.tracking} cancelled with the return` });
      return;
    }
    let waybill = r.tracking;
    if (!waybill && to === gmtcReturnAt()) waybill = await bookReturnPickup({ ...UPS, name: 'System' }, r.id);
    if (waybill && to === 'approved') await moveReturn({ ...UPS, name: 'System' }, r.id, 'pickup', { tracking: waybill });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const msg = to === 'rejected' ? `UPS pickup ${r.tracking} NOT cancelled: ${why}` : `UPS pickup NOT booked: ${why}`;
    await record({ orderId: r.orderId, returnId: r.id, at: new Date(), actorId: null, actorName: UPS.name, dept: null, kind: 'courier', message: msg.slice(0, 300) }).catch(() => {});
    publish({ kind: 'return', id: r.id, number: r.number, channelId: r.channelId, stage: r.stage, actor: UPS.name, message: `${r.number}: ${msg}`.slice(0, 300) });
  }
}

/** The last courier line on a return's timeline, so a failed attempt is written once, not every run. */
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

/** Asks GMTC about every booked return pickup and moves returns when the courier says so. */
export async function trackUpsReturns() {
  if (!gmtcConfigured('KW')) return { ok: false, note: 'UPS (GMTC) is not configured' };
  const db = await getDb();
  const open = (
    await db
      .select()
      .from(schema.returns)
      .where(and(inArray(schema.returns.stage, ['requested', 'approved', 'pickup', 'in_transit']), eq(schema.returns.method, 'pickup'), isNotNull(schema.returns.tracking)))
  ).filter(kuwait);
  if (!open.length) return { ok: true, note: 'No UPS return pickups open' };
  const answers = await trackConsignments(open.map((r) => r.tracking!));
  let moved = 0;
  for (const r of open) {
    const a = answers.get(r.tracking!);
    if (!a?.status) continue;
    const last = a.updates.at(-1);
    const cls = classifyGmtc(a.status);
    try {
      if (cls === 'exception') {
        const msg = `UPS: ${last?.description ?? a.status}${last?.comment ? ` · ${last.comment}` : ''}`.slice(0, 300);
        if ((await lastCourierLine(r.id)) !== msg) {
          await record({ orderId: r.orderId, returnId: r.id, at: last?.at ?? new Date(), actorId: null, actorName: UPS.name, dept: null, kind: 'courier', message: msg });
          publish({ kind: 'return', id: r.id, number: r.number, channelId: r.channelId, stage: r.stage, actor: UPS.name, message: `${r.number} · ${msg}` });
        }
        continue;
      }
      // approved while its booking was still on the way to GMTC: take it on to "Courier pickup" now
      if (r.stage === 'approved') {
        await moveReturn({ ...UPS, name: 'System' }, r.id, 'pickup', { tracking: r.tracking! });
        r.stage = 'pickup';
        moved++;
      }
      // care has not approved it yet: UPS may already have it, and approving takes it on from "Courier pickup"
      if (r.stage !== 'pickup' && r.stage !== 'in_transit') continue;
      const collected = collectedAt(a.updates);
      if (!collected) continue;
      if (r.stage === 'pickup') {
        await moveReturn(UPS, r.id, 'in_transit', { note: 'Collected by UPS' }, { at: collected });
        moved++;
      }
      if (cls === 'delivered') {
        await moveReturn(UPS, r.id, 'received', { note: 'Delivered to the warehouse by UPS' }, { at: last?.at ?? new Date() });
        moved++;
      }
    } catch {
      // a stage rule refused the move; the next run tries again
    }
  }
  return { ok: true, note: `${open.length} UPS return pickups checked · ${moved} moved` };
}
