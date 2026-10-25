import 'server-only';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { effectiveScopes, level, type Principal } from '../../domain/perms';
import { TRANSFER_STATUS, type TransferStatus } from '../../domain/stock/flows';
import { TASK_KIND, type TaskKind } from '../../domain/stock/work';
import { marketsFor } from './common';

export type TaskView = {
  id: string;
  number: string;
  kind: string;
  kindLabel: string;
  tint: string;
  area: string;
  title: string;
  detail: string | null;
  location: string | null;
  status: string;
  priority: number;
  dueAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  estMinutes: number;
  spentMinutes: number | null;
  units: number;
  source: string;
  assigneeId: string | null;
  assignee: string | null;
  blockedReason: string | null;
  ref: { type: string; id: string; label: string } | null;
};

async function toViews(rows: (typeof schema.tasks.$inferSelect)[]): Promise<TaskView[]> {
  const db = await getDb();
  const [users, locs, pos, trs] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users),
    db.select({ id: schema.locations.id, name: schema.locations.name }).from(schema.locations),
    db.select({ id: schema.purchaseOrders.id, number: schema.purchaseOrders.number }).from(schema.purchaseOrders).where(inArray(schema.purchaseOrders.id, rows.filter((r) => r.refType === 'po' && r.refId).map((r) => r.refId!).concat('-'))),
    db.select({ id: schema.transfers.id, number: schema.transfers.number }).from(schema.transfers).where(inArray(schema.transfers.id, rows.filter((r) => r.refType === 'transfer' && r.refId).map((r) => r.refId!).concat('-'))),
  ]);
  return rows.map((t) => {
    const k = TASK_KIND[t.kind as TaskKind];
    const ref = t.refType === 'po' ? pos.find((x) => x.id === t.refId) : t.refType === 'transfer' ? trs.find((x) => x.id === t.refId) : null;
    return {
      id: t.id,
      number: t.number,
      kind: t.kind,
      kindLabel: k?.label ?? t.kind,
      tint: k?.tint ?? 'neutral',
      area: t.area,
      title: t.title,
      detail: t.detail,
      location: locs.find((l) => l.id === t.locationId)?.name ?? null,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt?.toISOString() ?? null,
      startedAt: t.startedAt?.toISOString() ?? null,
      doneAt: t.doneAt?.toISOString() ?? null,
      estMinutes: t.estMinutes,
      spentMinutes: t.spentMinutes,
      units: t.units,
      source: t.source,
      assigneeId: t.assigneeId,
      assignee: users.find((u) => u.id === t.assigneeId)?.name ?? null,
      blockedReason: t.blockedReason,
      ref: ref ? { type: t.refType!, id: ref.id, label: ref.number } : null,
    };
  });
}

const order = sql`case ${schema.tasks.status} when 'doing' then 0 when 'blocked' then 1 else 2 end`;

/** Mine first: what I am on, what is waiting, what I finished today, and work nobody has taken yet. */
export async function myWork(p: Principal, areas: string[]) {
  const db = await getDb();
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, p.id));
  const open = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.assigneeId, p.id), inArray(schema.tasks.status, ['open', 'doing', 'blocked']), inArray(schema.tasks.area, areas)))
    .orderBy(order, asc(schema.tasks.priority), asc(schema.tasks.dueAt));
  const done = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.assigneeId, p.id), eq(schema.tasks.status, 'done'), sql`${schema.tasks.doneAt} > now() - interval '18 hours'`))
    .orderBy(desc(schema.tasks.doneAt))
    .limit(30);
  const grabs = await db
    .select()
    .from(schema.tasks)
    .where(and(isNull(schema.tasks.assigneeId), eq(schema.tasks.status, 'open'), inArray(schema.tasks.area, areas), me?.locationId ? or(isNull(schema.tasks.locationId), eq(schema.tasks.locationId, me.locationId)) : sql`true`))
    .orderBy(asc(schema.tasks.priority), asc(schema.tasks.dueAt))
    .limit(10);
  return { open: await toViews(open), done: await toViews(done), grabs: await toViews(grabs) };
}

/** The floor as a manager sees it: unassigned work, deliveries due, transfers moving. */
export async function floor(p: Principal) {
  const db = await getDb();
  const markets = marketsFor(p);
  const locIds = (await db.select({ id: schema.locations.id }).from(schema.locations).where(inArray(schema.locations.country, markets))).map((l) => l.id);
  const [loose, all, pos, trs, users] = await Promise.all([
    db.select().from(schema.tasks).where(and(isNull(schema.tasks.assigneeId), inArray(schema.tasks.status, ['open', 'blocked']))).orderBy(asc(schema.tasks.priority), asc(schema.tasks.dueAt)).limit(40),
    db
      .select()
      .from(schema.tasks)
      .where(and(inArray(schema.tasks.status, ['open', 'doing', 'blocked']), eq(schema.tasks.area, 'warehouse'), or(isNull(schema.tasks.locationId), inArray(schema.tasks.locationId, locIds.concat('-')))))
      .orderBy(order, asc(schema.tasks.priority), asc(schema.tasks.dueAt))
      .limit(200),
    db
      .select({ po: schema.purchaseOrders, supplier: schema.suppliers.name, location: schema.locations.name })
      .from(schema.purchaseOrders)
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.purchaseOrders.supplierId))
      .leftJoin(schema.locations, eq(schema.locations.id, schema.purchaseOrders.locationId))
      .where(and(inArray(schema.purchaseOrders.status, ['sent', 'confirmed', 'partial']), inArray(schema.purchaseOrders.market, markets), sql`${schema.purchaseOrders.expectedAt} < now() + interval '10 days'`))
      .orderBy(asc(schema.purchaseOrders.expectedAt)),
    db.select().from(schema.transfers).where(inArray(schema.transfers.fromId, locIds.concat('-'))).orderBy(desc(schema.transfers.createdAt)).limit(40),
    db.select().from(schema.users).where(eq(schema.users.active, true)),
  ]);
  const left = await db.execute<{ po_id: string; left: number }>(sql`select po_id, sum(greatest(qty - received - damaged, 0))::int as left from po_lines group by 1`);
  const locs = await db.select().from(schema.locations);
  const name = (id: string) => locs.find((l) => l.id === id)?.name ?? id;
  return {
    loose: await toViews(loose),
    all: await toViews(all),
    deliveries: pos.map(({ po, supplier, location }) => ({ id: po.id, number: po.number, supplier, location, status: po.status, expectedAt: po.expectedAt?.toISOString() ?? null, left: left.rows.find((x) => x.po_id === po.id)?.left ?? po.units, late: po.expectedAt != null && po.expectedAt.getTime() < Date.now() })),
    transfers: trs.map((t) => ({ id: t.id, number: t.number, from: name(t.fromId), to: name(t.toId), status: t.status as TransferStatus, label: TRANSFER_STATUS[t.status as TransferStatus]?.label ?? t.status, tint: TRANSFER_STATUS[t.status as TransferStatus]?.tint ?? 'neutral', units: t.units, reason: t.reason, createdAt: t.createdAt.toISOString(), createdByName: t.createdByName, source: t.source })),
    assignable: users
      .filter((u) => !['admin', 'viewer'].includes(u.role) && level({ scopes: effectiveScopes(u.role, u.scopes) }, 'warehouse') >= 2)
      .filter((u) => !p.channels.length || !u.channels.length || u.channels.some((c) => p.channels.includes(c)))
      .map((u) => ({ id: u.id, name: u.name })),
    locations: locs.filter((l) => markets.includes(l.country as 'EG' | 'KW')).map((l) => ({ id: l.id, name: l.name })),
  };
}
