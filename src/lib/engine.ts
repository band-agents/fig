import 'server-only';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL, channelLabel } from './channels';
import type { IncomingOrder } from './connectors/types';
import { autopilotRun, DEFAULT_AUTOPILOT, nextAutoStep, type AutopilotRules } from './domain/autopilot';
import { can, level, ROLES, seesChannel, type Principal } from './domain/perms';
import { normalisePhone, scoreRisk } from './domain/risk';
import { DEFAULT_SLA, dueFor, type SlaTargets } from './domain/sla';
import {
  DEPTS,
  isAllowed,
  ORDER_FLOW,
  ORDER_STAGE,
  RETURN_FLOW,
  RETURN_STAGE,
  type OrderStage,
  type ReturnReason,
  type ReturnStage,
} from './domain/stages';
import { eligibility, itemReturnable, policyFor } from './domain/returns-policy';
import {
  refundOptions,
  resolutionFor,
  resolveRefund,
  type PaymentMethod,
  type RefundMethod,
} from './domain/refund-methods';
import { findBranch } from './domain/branches';
import { forbidden, invalid, notFound } from './errors';
import { publish } from './bus';
import { queueWriteBack } from './writeback';

export type Actor = { id: string | null; name: string; dept: string | null; principal?: Principal };
export const AUTOPILOT: Actor = { id: null, name: 'Relay Autopilot', dept: null };
export const SYSTEM: Actor = { id: null, name: 'Relay', dept: null };

export const actorFor = (p: Principal): Actor => ({ id: p.id, name: p.name, dept: ROLES[p.role]?.label ?? null, principal: p });

type Opts = { at?: Date; quiet?: boolean };

// ── Settings ───────────────────────────────────────────────────────────────────────────────────
const settingCache = new Map<string, { at: number; value: unknown }>();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const hit = settingCache.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.value as T;
  const db = await getDb();
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  const value = row ? ({ ...fallback, ...(row.value as object) } as T) : fallback;
  settingCache.set(key, { at: Date.now(), value });
  return value;
}

export async function putSetting(key: string, value: unknown, by: string) {
  const db = await getDb();
  await db
    .insert(schema.settings)
    .values({ key, value, updatedBy: by })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
  settingCache.delete(key);
}

export const slaTargets = async () => {
  const s = await getSetting<SlaTargets>('sla', DEFAULT_SLA);
  return { orders: { ...DEFAULT_SLA.orders, ...s.orders }, returns: { ...DEFAULT_SLA.returns, ...s.returns } };
};
export const autopilotRules = () => getSetting<AutopilotRules>('autopilot', DEFAULT_AUTOPILOT);

// ── Learned context for risk ───────────────────────────────────────────────────────────────────
type Ctx = { at: number; medians: Map<string, number>; regionRto: Map<string, number>; baseline: number };
let ctxCache: Ctx | null = null;

async function riskContext(): Promise<Ctx> {
  if (ctxCache && Date.now() - ctxCache.at < 10 * 60_000) return ctxCache;
  const db = await getDb();
  const medians = await db.execute<{ channel_id: string; median: number }>(
    sql`select channel_id, percentile_cont(0.5) within group (order by total)::float8 as median from orders group by channel_id`,
  );
  const rto = await db.execute<{ region: string; rate: number; n: number }>(sql`
    select coalesce(address->>'region', '') as region,
           avg(case when stage in ('rto','rto_closed') then 1.0 else 0 end)::float8 as rate,
           count(*)::int as n
    from orders where payment_method = 'cod' and stage in ('delivered','settled','rto','rto_closed')
    group by 1 having count(*) >= 8`);
  const all = rto.rows.reduce((a, r) => ({ s: a.s + r.rate * r.n, n: a.n + r.n }), { s: 0, n: 0 });
  ctxCache = {
    at: Date.now(),
    medians: new Map(medians.rows.map((r) => [r.channel_id, Number(r.median)])),
    regionRto: new Map(rto.rows.map((r) => [r.region, Number(r.rate)])),
    baseline: all.n ? all.s / all.n : 0,
  };
  return ctxCache;
}

export const invalidateRiskContext = (force = false) => {
  if (force || (ctxCache && Date.now() - ctxCache.at > 60_000)) ctxCache = null;
};

async function historyFor(customerId: string | null, excludeOrderId?: string) {
  if (!customerId) return null;
  const db = await getDb();
  const rows = await db.execute<{ orders: number; delivered: number; refused: number; returned: number }>(sql`
    select count(*)::int as orders,
      count(*) filter (where stage in ('delivered','settled'))::int as delivered,
      count(*) filter (where stage in ('rto','rto_closed'))::int as refused,
      (select count(distinct r.order_id)::int from returns r join orders o2 on o2.id = r.order_id where o2.customer_id = ${customerId}) as returned
    from orders where customer_id = ${customerId} ${excludeOrderId ? sql`and id <> ${excludeOrderId}` : sql``}`);
  return rows.rows[0] ?? null;
}

export async function refreshCustomer(customerId: string | null) {
  if (!customerId) return;
  const h = await historyFor(customerId);
  if (!h) return;
  const db = await getDb();
  await db
    .update(schema.customers)
    .set({ orders: h.orders, delivered: h.delivered, refused: h.refused, returned: h.returned, vip: h.delivered >= 5 && h.refused === 0 })
    .where(eq(schema.customers.id, customerId));
}

// ── Events ─────────────────────────────────────────────────────────────────────────────────────
export async function record(e: typeof schema.events.$inferInsert) {
  const db = await getDb();
  await db.insert(schema.events).values(e);
}

// ── Ingest ─────────────────────────────────────────────────────────────────────────────────────
async function upsertCustomer(inc: IncomingOrder, phone: string | null, at: Date) {
  const db = await getDb();
  const country = CHANNEL[inc.channelId]?.country ?? 'EG';
  const email = inc.email?.trim().toLowerCase() || null;
  let found: typeof schema.customers.$inferSelect | undefined;
  if (phone) [found] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  if (!found && email) [found] = await db.select().from(schema.customers).where(eq(schema.customers.email, email)).limit(1);
  if (found) {
    if ((!found.email && email) || (!found.phone && phone)) {
      await db.update(schema.customers).set({ email: found.email ?? email, phone: found.phone ?? phone }).where(eq(schema.customers.id, found.id));
    }
    return found.id;
  }
  const [row] = await db
    .insert(schema.customers)
    .values({ phone, email, name: inc.customerName, city: inc.address?.city ?? null, region: inc.address?.region ?? null, country, firstSeenAt: at })
    .returning({ id: schema.customers.id });
  return row.id;
}

/** Brings one platform order into Relay: new orders get a risk score and go through Autopilot;
 *  known orders only take forward-moving facts (paid, cancelled, fulfilled, delivered). */
export async function ingestOrder(inc: IncomingOrder, opts: Opts & { autopilot?: boolean } = {}) {
  const db = await getDb();
  const at = opts.at ?? new Date();
  const channel = CHANNEL[inc.channelId];
  const country = channel?.country ?? 'EG';
  const phone = normalisePhone(inc.phone ?? inc.address?.phone, country);

  const [existing] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.channelId, inc.channelId), eq(schema.orders.externalId, inc.externalId)))
    .limit(1);

  if (existing) {
    const patch: Partial<typeof schema.orders.$inferInsert> = { syncedAt: at, updatedAt: at };
    if (existing.paymentStatus !== inc.paymentStatus && !(existing.paymentStatus === 'cod_collected' && inc.paymentStatus === 'cod_due')) {
      patch.paymentStatus = inc.paymentStatus;
      await record({ orderId: existing.id, at, actorName: channelLabel(inc.channelId), kind: 'payment', message: `Payment is now ${inc.paymentStatus.replace('_', ' ')} on ${channelLabel(inc.channelId)}` });
    }
    if (Object.keys(patch).length > 2) await db.update(schema.orders).set(patch).where(eq(schema.orders.id, existing.id));
    await applyPlatformFacts(existing.id, inc);
    if (!opts.quiet) publish({ kind: 'order', id: existing.id, number: existing.number, channelId: existing.channelId, message: 'updated' });
    return { id: existing.id, created: false };
  }

  const customerId = await upsertCustomer(inc, phone, inc.placedAt);
  const history = await historyFor(customerId);
  const ctx = await riskContext();
  const since = new Date(inc.placedAt.getTime() - 86400000);
  const dupes = phone
    ? (await db.select({ n: sql<number>`count(*)::int` }).from(schema.orders).where(and(eq(schema.orders.phone, phone), gte(schema.orders.placedAt, since), ne(schema.orders.stage, 'cancelled'))))[0].n
    : 0;

  const risk = scoreRisk({
    paymentMethod: inc.paymentMethod,
    total: inc.total,
    currency: inc.currency,
    phone,
    email: inc.email,
    country,
    address: inc.address,
    placedAt: inc.placedAt,
    items: inc.items,
    history,
    recentSamePhone: dupes,
    channelMedian: ctx.medians.get(inc.channelId),
    regionRtoRate: ctx.regionRto.get(inc.address?.region ?? '') ?? null,
    baselineRtoRate: ctx.baseline,
  });

  const targets = await slaTargets();
  const [order] = await db
    .insert(schema.orders)
    .values({
      channelId: inc.channelId,
      externalId: inc.externalId,
      number: inc.number,
      source: inc.source,
      placedAt: inc.placedAt,
      customerId,
      customerName: inc.customerName,
      phone,
      email: inc.email ?? null,
      address: inc.address ?? null,
      currency: inc.currency,
      subtotal: inc.subtotal,
      shipping: inc.shipping,
      discount: inc.discount,
      total: inc.total,
      paymentMethod: inc.paymentMethod,
      paymentStatus: inc.paymentStatus,
      stage: 'new',
      stageAt: inc.placedAt,
      dueAt: dueFor('orders', 'new', inc.placedAt, targets),
      risk: risk.score,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
      tags: inc.tags ?? [],
      items: inc.items.reduce((s, i) => s + i.quantity, 0),
      courier: channel?.carrier ?? null,
      note: inc.note ?? null,
      syncedAt: at,
      createdAt: at,
      updatedAt: at,
    })
    .returning();

  const policy = policyFor(channel?.brand ?? 'FIG', country);
  if (inc.items.length) {
    await db.insert(schema.orderItems).values(
      inc.items.map((i) => ({
        orderId: order.id,
        sku: i.sku ?? null,
        barcode: i.barcode ?? null,
        title: i.title,
        variant: i.variant ?? null,
        size: i.size ?? null,
        brand: i.brand ?? null,
        category: i.category ?? null,
        image: i.image ?? null,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        returnable: itemReturnable(policy, i),
      })),
    );
  }

  await record({
    orderId: order.id,
    at: inc.placedAt,
    actorName: channelLabel(inc.channelId),
    kind: 'system',
    toStage: 'new',
    message: `Placed on ${channelLabel(inc.channelId)} · ${inc.items.reduce((s, i) => s + i.quantity, 0)} item${inc.items.length === 1 && inc.items[0].quantity === 1 ? '' : 's'}`,
  });
  if (risk.level !== 'low') {
    await record({
      orderId: order.id,
      at: inc.placedAt,
      actorName: 'Relay Risk',
      kind: 'risk',
      message: `${risk.level === 'high' ? 'High' : 'Medium'} delivery risk (${risk.score}): ${risk.reasons.slice(0, 3).map((r) => r.label.toLowerCase()).join(', ')}`,
      data: { score: risk.score, reasons: risk.reasons },
    });
  }

  const moved = await applyPlatformFacts(order.id, inc);
  if (!moved && opts.autopilot !== false) await runAutopilot(order.id, { at: opts.at ? inc.placedAt : undefined, quiet: true });

  if (!opts.quiet) publish({ kind: 'order', id: order.id, number: order.number, channelId: order.channelId, stage: 'new', message: `New order ${order.number}` });
  return { id: order.id, created: true };
}

/** Facts from the store only ever move an order forward, so a slow webhook can't undo the floor's work. */
async function applyPlatformFacts(orderId: string, inc: IncomingOrder) {
  const f = inc.platform;
  if (!f) return false;
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) return false;
  const order = (s: string) => ['new', 'confirming', 'finance', 'ready', 'picking', 'packed', 'shipped', 'delivering', 'delivered', 'settled'].indexOf(s);
  const who: Actor = { id: null, name: channelLabel(inc.channelId), dept: null };
  if (f.cancelled && !['cancelled', 'settled', 'rto', 'rto_closed'].includes(o.stage)) {
    await setStage(o, 'cancelled', who, { at: f.cancelled.at, reason: f.cancelled.reason ?? 'Cancelled in the store', viaPlatform: true });
    return true;
  }
  if (f.delivered && order(o.stage) >= 0 && order(o.stage) < order('delivered')) {
    await setStage(o, 'delivered', who, { at: f.delivered.at, viaPlatform: true });
    return true;
  }
  if (f.fulfilled && order(o.stage) >= 0 && order(o.stage) < order('shipped')) {
    await setStage(o, 'shipped', who, { at: f.fulfilled.at, tracking: f.fulfilled.tracking ?? undefined, courier: f.fulfilled.company ?? undefined, trackingUrl: f.fulfilled.url ?? undefined, viaPlatform: true });
    return true;
  }
  return false;
}

// ── Stage changes ──────────────────────────────────────────────────────────────────────────────
type MoveInput = { reason?: string; tracking?: string; courier?: string; trackingUrl?: string; note?: string };

const STAMP: Partial<Record<OrderStage, keyof typeof schema.orders.$inferInsert>> = {
  finance: 'confirmedAt',
  ready: 'approvedAt',
  packed: 'packedAt',
  shipped: 'shippedAt',
  delivered: 'deliveredAt',
  settled: 'closedAt',
  cancelled: 'closedAt',
  rto_closed: 'closedAt',
};

async function setStage(
  o: typeof schema.orders.$inferSelect,
  to: OrderStage,
  actor: Actor,
  input: MoveInput & { at?: Date; viaPlatform?: boolean; autopilot?: string } = {},
) {
  const db = await getDb();
  const at = input.at ?? new Date();
  const targets = await slaTargets();
  const patch: Partial<typeof schema.orders.$inferInsert> = {
    stage: to,
    stageAt: at,
    dueAt: dueFor('orders', to, at, targets),
    updatedAt: at,
    exception: null,
  };
  const stamp = STAMP[to];
  if (stamp) (patch as Record<string, unknown>)[stamp] = at;
  if (to === 'finance' && o.stage === 'new') patch.confirmedAt = null;
  if (input.tracking) patch.tracking = input.tracking;
  if (input.courier) patch.courier = input.courier;
  if (input.trackingUrl) patch.trackingUrl = input.trackingUrl;
  if (to === 'cancelled') patch.cancelReason = input.reason ?? null;
  if (to === 'delivered' && o.paymentMethod === 'cod') patch.paymentStatus = 'cod_collected';
  if (to === 'settled' && o.paymentMethod === 'cod') patch.paymentStatus = 'paid';
  if (to === 'cancelled' || to === 'settled' || to === 'rto_closed') patch.onHold = false;
  if (input.autopilot) patch.autopilot = [...(o.autopilot ?? []), o.stage];

  await db.update(schema.orders).set(patch).where(eq(schema.orders.id, o.id));

  const meta = ORDER_STAGE[to];
  const message = input.viaPlatform
    ? `${meta.label} in ${actor.name}${input.tracking ? ` · ${input.courier ?? ''} ${input.tracking}`.trimEnd() : ''}`
    : input.autopilot
      ? `${meta.label}: ${input.autopilot}`
      : `${meta.label}${input.reason ? ` · ${input.reason}` : ''}${input.tracking ? ` · ${input.courier ?? o.courier ?? ''} ${input.tracking}`.replace('  ', ' ') : ''}`;
  await record({
    orderId: o.id,
    at,
    actorId: actor.id,
    actorName: actor.name,
    dept: actor.dept,
    kind: 'stage',
    fromStage: o.stage,
    toStage: to,
    message,
    data: input.note ? { note: input.note } : undefined,
  });
  if (input.note) await record({ orderId: o.id, at, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'note', message: input.note });

  if (['delivered', 'settled', 'rto', 'rto_closed', 'cancelled'].includes(to)) {
    await refreshCustomer(o.customerId);
    invalidateRiskContext();
  }
  if (!input.viaPlatform) queueWriteBack(o.id, to, input);
}

/** A person moves an order. The transition must exist, and their access must cover its area. */
export async function moveOrder(actor: Actor, orderId: string, to: OrderStage, input: MoveInput = {}, opts: Opts = {}) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound('Order not found.');
  const t = isAllowed(ORDER_FLOW, o.stage as OrderStage, to);
  if (!t) throw invalid(`An order that is ${ORDER_STAGE[o.stage as OrderStage]?.label.toLowerCase()} can't go to ${ORDER_STAGE[to].label.toLowerCase()}.`);
  if (actor.principal) {
    if (!seesChannel(actor.principal, o.channelId)) throw forbidden();
    if (level(actor.principal, t.area) < (t.level ?? 2)) throw forbidden(`Moving to ${ORDER_STAGE[to].label} needs ${DEPTS[deptOfArea(t.area)]?.label ?? t.area} access.`);
  }
  if (o.onHold && to !== 'cancelled') throw invalid('This order is on hold. Release the hold first.');
  if (t.needs?.includes('reason') && !input.reason?.trim()) throw invalid('Give a reason.');
  if (t.needs?.includes('tracking') && !input.tracking?.trim()) throw invalid('Add the waybill number.');
  if (t.needs?.includes('note') && !input.note?.trim()) throw invalid('Add a note.');
  await setStage(o, to, actor, { ...input, at: opts.at });
  await runAutopilot(o.id, { at: opts.at, quiet: true });
  if (!opts.quiet) publish({ kind: 'order', id: o.id, number: o.number, channelId: o.channelId, stage: to, actor: actor.name, message: `${o.number} → ${ORDER_STAGE[to].label}` });
}

const deptOfArea = (a: string) =>
  (Object.entries(DEPTS).find(([, d]) => d.area === a)?.[0] ?? 'care') as keyof typeof DEPTS;

export async function runAutopilot(orderId: string, opts: Opts = {}) {
  const db = await getDb();
  const rules = await autopilotRules();
  if (!rules.enabled) return [];
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) return [];
  const h = await historyFor(o.customerId, o.id);
  const steps = autopilotRun(o, h, rules);
  let cur = o;
  let t = opts.at ?? new Date();
  for (const s of steps) {
    t = new Date(t.getTime() + (opts.at ? 40_000 + Math.random() * 90_000 : 0));
    await setStage(cur, s.to, AUTOPILOT, { at: t, autopilot: s.why });
    [cur] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  }
  return steps;
}

export async function autopilotPreview(orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) return null;
  return nextAutoStep(o, await historyFor(o.customerId, o.id), await autopilotRules());
}

export async function setHold(actor: Actor, orderId: string, on: boolean, reason?: string, opts: Opts = {}) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound();
  const area = DEPTS[(ORDER_STAGE[o.stage as OrderStage]?.dept as keyof typeof DEPTS) ?? 'care']?.area ?? 'orders';
  if (actor.principal && !(can(actor.principal, area, 2) || can(actor.principal, 'orders', 3))) throw forbidden();
  if (on && !reason?.trim()) throw invalid('Say why it is on hold.');
  const at = opts.at ?? new Date();
  const targets = await slaTargets();
  await db
    .update(schema.orders)
    .set({ onHold: on, holdReason: on ? reason! : null, updatedAt: at, ...(on ? {} : { stageAt: at, dueAt: dueFor('orders', o.stage, at, targets) }) })
    .where(eq(schema.orders.id, orderId));
  await record({ orderId, at, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'hold', message: on ? `On hold · ${reason}` : 'Hold released, clock restarted' });
  if (!opts.quiet) publish({ kind: 'order', id: o.id, number: o.number, channelId: o.channelId, actor: actor.name, message: on ? `${o.number} on hold` : `${o.number} released` });
  if (!on) await runAutopilot(orderId, { quiet: true });
}

export async function addNote(actor: Actor, target: { orderId?: string; returnId?: string }, message: string, kind: 'note' | 'call' = 'note', opts: Opts & { data?: Record<string, unknown> } = {}) {
  if (!message.trim()) throw invalid('Write something first.');
  if (actor.principal && !can(actor.principal, 'orders', 1)) throw forbidden();
  await record({ ...target, at: opts.at ?? new Date(), actorId: actor.id, actorName: actor.name, dept: actor.dept, kind, message: message.trim(), data: opts.data });
  if (!opts.quiet) publish({ kind: target.returnId ? 'return' : 'order', id: target.orderId ?? target.returnId, actor: actor.name, message: kind === 'call' ? 'call logged' : 'note added' });
}

export async function assign(actor: Actor, orderId: string, userId: string | null) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound();
  if (actor.principal) {
    const dept = ORDER_STAGE[o.stage as OrderStage]?.dept;
    const area = dept && dept !== 'none' ? DEPTS[dept].area : null;
    if (!seesChannel(actor.principal, o.channelId) || !(can(actor.principal, 'orders', 3) || (area && can(actor.principal, area, 2)))) throw forbidden('Only the team that has this order can assign it.');
  }
  let name = 'nobody';
  if (userId) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!u) throw notFound('No such teammate.');
    name = u.name;
  }
  await db.update(schema.orders).set({ assigneeId: userId, updatedAt: new Date() }).where(eq(schema.orders.id, orderId));
  await record({ orderId, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'assign', message: userId === actor.id ? 'Took this order' : `Assigned to ${name}` });
  publish({ kind: 'order', id: o.id, number: o.number, actor: actor.name, message: 'assigned' });
}

export async function flagException(actor: Actor, orderId: string, message: string, opts: Opts & { attempt?: boolean } = {}) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound();
  const at = opts.at ?? new Date();
  await db.update(schema.orders).set({ exception: message, attempts: opts.attempt ? o.attempts + 1 : o.attempts, updatedAt: at }).where(eq(schema.orders.id, orderId));
  await record({ orderId, at, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'courier', message });
  if (!opts.quiet) publish({ kind: 'order', id: o.id, number: o.number, message });
}

// ── Returns ────────────────────────────────────────────────────────────────────────────────────
export async function nextRmaNumber() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.returns);
  return `RMA-${String(4100 + n + 1)}`;
}

export async function openReturn(
  actor: Actor,
  orderId: string,
  input: {
    items: { orderItemId: string; quantity: number }[];
    reason: ReturnReason;
    note?: string;
    resolution?: 'refund' | 'exchange' | 'credit';
    method?: 'pickup' | 'store';
    /** Where the money goes. What it pays is decided here, not by the caller. */
    refundMethod?: RefundMethod;
    /** portal | app for a customer opening their own return, agent for someone on the floor. */
    openedVia?: 'portal' | 'app' | 'agent';
    /** The shop they are bringing it to, as an id from domain/branches.ts. */
    branch?: string | null;
    override?: boolean;
  },
  opts: Opts = {},
) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound('Order not found.');
  if (actor.principal) {
    if (!seesChannel(actor.principal, o.channelId)) throw forbidden();
    if (!can(actor.principal, 'returns', 2) && !can(actor.principal, 'intake', 2)) throw forbidden('Opening a return needs Customer care or Returns access.');
  }
  if (!['delivered', 'settled'].includes(o.stage)) throw invalid('Only delivered orders can be returned.');
  const channel = CHANNEL[o.channelId];
  const policy = policyFor(channel?.brand ?? 'FIG', channel?.country ?? 'EG');
  const now = opts.at ?? new Date();
  const elig = eligibility(policy, o.deliveredAt, now);
  const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  const picked = input.items.filter((i) => i.quantity > 0).map((i) => ({ ...i, line: lines.find((l) => l.id === i.orderItemId) }));
  if (!picked.length) throw invalid('Pick at least one item.');
  const finalSale = picked.filter((p) => p.line && !p.line.returnable);
  const overriding = (!elig.ok || finalSale.length > 0) && input.override;
  if (!overriding) {
    if (!elig.ok) throw invalid(elig.why);
    if (finalSale.length) throw invalid(`${finalSale[0].line!.title} is final sale under this store's policy.`);
  }
  if (overriding && actor.principal && !can(actor.principal, 'returns', 3)) throw forbidden('Only a returns manager can override the policy.');
  if (overriding && !input.note?.trim()) throw invalid('Say why the policy is being overridden.');

  const amount = picked.reduce((s, p) => s + (p.line?.unitPrice ?? 0) * Math.min(p.quantity, p.line?.quantity ?? 0), 0);

  /* What the refund is worth, and whether it earns the store-credit bonus, is settled here from
     the order's own payment method. The request may name a method but never an amount: a customer
     asking for store credit on an order they paid for with store credit still gets no bonus. */
  const options = refundOptions({
    amount,
    currency: o.currency,
    payment: o.paymentMethod as PaymentMethod,
    policy,
    settled: o.paymentStatus !== 'pending' && o.paymentStatus !== 'cod_due',
  });
  const refund = resolveRefund(input.refundMethod ?? 'original', options);

  /* A branch is only ever one of ours, and only for this order's own market. An id that is not on
     that list is dropped rather than stored: a return that says it is going to a shop that does not
     exist would send someone out for nothing. */
  const branch = findBranch(channel?.brand ?? 'FIG', channel?.country ?? 'EG', input.branch);

  const number = await nextRmaNumber();
  const targets = await slaTargets();
  const [ret] = await db
    .insert(schema.returns)
    .values({
      number,
      orderId,
      channelId: o.channelId,
      customerId: o.customerId,
      requestedAt: now,
      stage: 'requested',
      stageAt: now,
      dueAt: dueFor('returns', 'requested', now, targets),
      reason: input.reason,
      reasonNote: input.note ?? null,
      resolution: input.resolution ?? resolutionFor(refund.method),
      method: policy.storeOnly ? 'store' : (input.method ?? 'pickup'),
      refundMethod: refund.method,
      currency: o.currency,
      /* What the customer receives, bonus included, so finance never has to recompute it. */
      amount: refund.amount,
      bonus: refund.bonus,
      openedVia: input.openedVia ?? 'agent',
      branch: branch?.id ?? null,
      createdAt: now,
    })
    .returning();
  await db.insert(schema.returnItems).values(picked.map((p) => ({ returnId: ret.id, orderItemId: p.orderItemId, quantity: p.quantity, reason: input.reason })));
  const via = input.openedVia === 'portal' ? ' · opened by the customer' : input.openedVia === 'app' ? ' · opened in the app' : '';
  const paid = refund.bonus > 0 ? ` · ${refund.method.replace(/_/g, ' ')} +${refund.bonus} bonus` : ` · ${refund.method.replace(/_/g, ' ')}`;
  const msg = `Return ${number} opened · ${picked.length} item${picked.length > 1 ? 's' : ''}${paid}${via}${overriding ? ' · policy overridden' : ''}`;
  await record({ orderId, returnId: ret.id, at: now, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'stage', toStage: 'requested', message: msg, data: input.note ? { note: input.note } : undefined });
  await refreshCustomer(o.customerId);
  if (!opts.quiet) publish({ kind: 'return', id: ret.id, number, channelId: o.channelId, stage: 'requested', actor: actor.name, message: msg });
  return ret;
}

export async function moveReturn(
  actor: Actor,
  returnId: string,
  to: ReturnStage,
  input: MoveInput & { inspection?: 'pass' | 'damaged' | 'wrong_item' | 'partial'; restock?: boolean } = {},
  opts: Opts = {},
) {
  const db = await getDb();
  const [r] = await db.select().from(schema.returns).where(eq(schema.returns.id, returnId));
  if (!r) throw notFound('Return not found.');
  const t = isAllowed(RETURN_FLOW, r.stage as ReturnStage, to);
  if (!t) throw invalid(`A return that is ${RETURN_STAGE[r.stage as ReturnStage].label.toLowerCase()} can't go to ${RETURN_STAGE[to].label.toLowerCase()}.`);
  if (actor.principal) {
    if (!seesChannel(actor.principal, r.channelId)) throw forbidden();
    if (level(actor.principal, t.area) < (t.level ?? 2)) throw forbidden();
  }
  if (t.needs?.includes('reason') && !input.reason?.trim()) throw invalid('Give a reason.');
  if (t.needs?.includes('tracking') && !input.tracking?.trim()) throw invalid('Add the pickup waybill.');
  if (t.needs?.includes('note') && !input.note?.trim()) throw invalid('Add a note.');
  if (to === 'inspected' && !input.inspection) throw invalid('Record the inspection result.');
  const at = opts.at ?? new Date();
  const targets = await slaTargets();
  await db
    .update(schema.returns)
    .set({
      stage: to,
      stageAt: at,
      dueAt: dueFor('returns', to, at, targets),
      ...(input.tracking ? { tracking: input.tracking } : {}),
      ...(input.inspection ? { inspection: input.inspection, restocked: input.restock ?? input.inspection === 'pass' } : {}),
      ...(['refunded', 'closed', 'rejected'].includes(to) ? { closedAt: at } : {}),
    })
    .where(eq(schema.returns.id, returnId));
  const meta = RETURN_STAGE[to];
  const detail =
    to === 'inspected'
      ? ` · ${input.inspection === 'pass' ? 'passed, back to stock' : input.inspection === 'damaged' ? 'damaged, not restocked' : input.inspection === 'wrong_item' ? 'wrong item returned' : 'partly accepted'}`
      : input.reason
        ? ` · ${input.reason}`
        : input.tracking
          ? ` · ${input.tracking}`
          : '';
  await record({ orderId: r.orderId, returnId, at, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'stage', fromStage: r.stage, toStage: to, message: `${r.number} ${meta.label.toLowerCase()}${detail}`, data: input.note ? { note: input.note } : undefined });
  if (to === 'refunded') {
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    if (o) {
      const lines = await db.select({ q: schema.orderItems.quantity }).from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));
      const all = await db.select({ q: schema.returnItems.quantity }).from(schema.returnItems).innerJoin(schema.returns, eq(schema.returns.id, schema.returnItems.returnId)).where(and(eq(schema.returns.orderId, o.id), eq(schema.returns.stage, 'refunded')));
      const full = all.reduce((s, x) => s + x.q, 0) >= lines.reduce((s, x) => s + x.q, 0);
      await db.update(schema.orders).set({ paymentStatus: full ? 'refunded' : 'partially_refunded', updatedAt: at }).where(eq(schema.orders.id, o.id));
    }
  }
  if (!opts.quiet) publish({ kind: 'return', id: r.id, number: r.number, channelId: r.channelId, stage: to, actor: actor.name, message: `${r.number} → ${meta.label}` });
}

// ── Lookups used by several screens ─────────────────────────────────────────────────────────────
export async function orderWithLines(orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) return null;
  const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  return { ...o, lines };
}

export async function recentEvents(limit = 30, channelIds?: string[]) {
  const db = await getDb();
  const q = db
    .select({ e: schema.events, number: schema.orders.number, channelId: schema.orders.channelId })
    .from(schema.events)
    .leftJoin(schema.orders, eq(schema.orders.id, schema.events.orderId))
    .orderBy(desc(schema.events.at))
    .limit(limit);
  if (channelIds?.length) return q.where(inArray(schema.orders.channelId, channelIds));
  return q;
}
