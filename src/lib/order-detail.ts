import 'server-only';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL } from './channels';
import { can, maskName, maskPhone, seesChannel, type Principal } from './domain/perms';
import { eligibility, policyFor } from './domain/returns-policy';
import { DEPTS, ORDER_STAGE, type OrderStage } from './domain/stages';
import { autopilotPreview } from './engine';

export async function orderDetail(p: Principal, id: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
  if (!o || !seesChannel(p, o.channelId)) return null;
  const [lines, events, rets, customer, team] = await Promise.all([
    db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id)),
    db
      .select({ e: schema.events, hue: schema.users.hue })
      .from(schema.events)
      .leftJoin(schema.users, eq(schema.users.id, schema.events.actorId))
      .where(and(eq(schema.events.orderId, id), sql`${schema.events.at} <= now()`))
      .orderBy(asc(schema.events.at)),
    db.select().from(schema.returns).where(eq(schema.returns.orderId, id)).orderBy(desc(schema.returns.requestedAt)),
    o.customerId ? db.select().from(schema.customers).where(eq(schema.customers.id, o.customerId)).then((r) => r[0] ?? null) : null,
    db.select({ id: schema.users.id, name: schema.users.name, hue: schema.users.hue, role: schema.users.role, channels: schema.users.channels, scopes: schema.users.scopes }).from(schema.users).where(eq(schema.users.active, true)),
  ]);
  const others = o.customerId
    ? await db
        .select({ id: schema.orders.id, number: schema.orders.number, channelId: schema.orders.channelId, stage: schema.orders.stage, placedAt: schema.orders.placedAt, total: schema.orders.total, currency: schema.orders.currency })
        .from(schema.orders)
        .where(and(eq(schema.orders.customerId, o.customerId), ne(schema.orders.id, o.id)))
        .orderBy(desc(schema.orders.placedAt))
        .limit(8)
    : [];

  const channel = CHANNEL[o.channelId];
  const policy = policyFor(channel?.brand ?? 'FIG', channel?.country ?? 'EG');
  const pii = can(p, 'customers', 1);
  const contact = can(p, 'customers', 2);
  const seesMoney = can(p, 'money', 1);
  const stageMeta = ORDER_STAGE[o.stage as OrderStage];
  const ownerArea = stageMeta?.dept && stageMeta.dept !== 'none' ? DEPTS[stageMeta.dept].area : null;
  const assignable = team.filter((u) => (!u.channels.length || u.channels.includes(o.channelId)) && (!ownerArea || (u.scopes[ownerArea] ?? 0) >= 2));

  // When each stage was reached, and by whom: drives the tracker
  const reached: Record<string, { at: Date; by: string }> = {};
  for (const { e } of events) if (e.kind === 'stage' && e.toStage && !e.returnId) reached[e.toStage] = { at: e.at, by: e.actorName };
  reached.new ??= { at: o.placedAt, by: channel?.name ?? 'Store' };

  return {
    order: {
      ...o,
      customerName: pii ? o.customerName : maskName(o.customerName),
      phone: contact ? o.phone : maskPhone(o.phone),
      email: contact ? o.email : null,
      address: contact ? o.address : o.address ? { line1: '', city: pii ? o.address.city : '', region: o.address.region, country: o.address.country } : null,
      subtotal: seesMoney ? o.subtotal : null,
      shipping: seesMoney ? o.shipping : null,
      discount: seesMoney ? o.discount : null,
      total: seesMoney ? o.total : null,
    },
    lines: lines.map((l) => ({ ...l, unitPrice: seesMoney ? l.unitPrice : null })),
    events: events.map(({ e, hue }) => ({ ...e, hue })),
    returns: rets,
    customer: customer && pii ? customer : customer ? { ...customer, name: maskName(customer.name), phone: null, email: null } : null,
    others: others.map((x) => ({ ...x, total: seesMoney ? x.total : null })),
    reached,
    assignable: assignable.map((u) => ({ id: u.id, name: u.name, hue: u.hue })),
    policy: { label: policy.label, storeOnly: policy.storeOnly, ...eligibility(policy, o.deliveredAt) },
    autopilotNext: await autopilotPreview(o.id),
    can: { pii, contact, money: seesMoney, returns: can(p, 'returns', 2) || can(p, 'intake', 2), override: can(p, 'returns', 3), note: can(p, 'orders', 1), work: can(p, 'orders', 3) || (ownerArea ? can(p, ownerArea, 2) : false) },
  };
}
export type OrderDetail = NonNullable<Awaited<ReturnType<typeof orderDetail>>>;
