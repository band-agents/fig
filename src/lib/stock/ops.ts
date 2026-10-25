import 'server-only';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { AREAS, can, level, type Area, type Principal, type Scopes } from '../domain/perms';
import { needsSecondSignature, poStep, PO_STATUS, TRANSFER_FLOW, TRANSFER_STATUS, type PoStatus, type TransferStatus } from '../domain/stock/flows';
import { pickAssignee, TASK_KIND, type TaskKind } from '../domain/stock/work';
import { splitSizes } from '../domain/stock/forecast';
import { CHANNEL, COUNTRIES, envPrefixFor, registerChannels, type ChannelDef, type Country, type Platform } from '../channels';
import { forbidden, invalid, notFound } from '../errors';
import { money, num } from '../format';
import { egpMinor, logActivity, nextNumber, stockChanged, stockRules, type StockRules, type Who } from './core';
import { postMove } from './hooks';
import { invalidateFacts } from './facts';
import { candidatesFor, createTask } from './planner';

// Every change to stock, buying, warehouse work and the websites' placements goes through here.
// Each function checks the person's access, does the work, writes the activity log, and tells
// open screens to refresh. Nothing else writes to these tables.

type P = Principal & { name: string };

/**
 * The planner acting on its own, when the AI is allowed to (Rules → the AI planner). It may draft and
 * submit; it never approves a purchase order or publishes to a website, whatever its scopes say.
 */
export const PLANNER_ID = 'planner';
export const PLANNER_PRINCIPAL: P = { id: PLANNER_ID, name: 'AI planner', role: 'admin', scopes: Object.fromEntries(AREAS.map((a) => [a, 3])) as Scopes, channels: [] };
const who = (p: P): Who => ({ id: p.id, name: p.name });
const need = (p: P, area: Area, min: 1 | 2 | 3, what: string) => {
  if (!can(p, area, min)) throw forbidden(`${what} needs more ${area} access than you have.`);
};
const done = (message: string) => {
  invalidateFacts();
  stockChanged(message);
  return message;
};

async function warehouseOf(market: string) {
  const db = await getDb();
  const [w] = await db.select().from(schema.locations).where(and(eq(schema.locations.kind, 'warehouse'), eq(schema.locations.country, market))).orderBy(asc(schema.locations.createdAt)).limit(1);
  if (!w) throw invalid(`There is no warehouse set up for ${market}.`);
  return w;
}

// ── Recommendations ───────────────────────────────────────────────────────────────────────────

export async function acceptRecommendation(p: P, id: string, opts: { publish?: boolean; channels?: string[]; headline?: string; headlineAr?: string; offer?: string } = {}) {
  const db = await getDb();
  const [r] = await db.select().from(schema.recommendations).where(eq(schema.recommendations.id, id));
  if (!r) throw notFound('That proposal is gone.');
  if (r.status !== 'open') throw invalid('Someone has already decided this one.');
  const payload = r.payload as Record<string, unknown>;
  let result = '';
  let status: 'accepted' | 'done' = 'accepted';

  switch (r.kind) {
    case 'reorder': {
      need(p, 'procurement', 2, 'Turning a reorder into a purchase order');
      const [prod] = await db.select().from(schema.products).where(eq(schema.products.id, r.productId!));
      if (!prod?.supplierId) throw invalid('This style has no supplier set.');
      const wh = await warehouseOf(prod.market);
      const po = await draftPoFor(p, prod.supplierId, wh.id, prod.market, prod.company, prod.currency, 'ai', `From the AI plan, accepted by ${p.name}`);
      const sizes = (payload.sizes as Record<string, number>) ?? {};
      const vars = await db.select().from(schema.variants).where(eq(schema.variants.productId, prod.id));
      for (const v of vars) {
        const qty = sizes[v.size ?? ''] ?? (vars.length === 1 ? Number(payload.qty) : 0);
        if (qty > 0) await db.insert(schema.poLines).values({ poId: po.id, productId: prod.id, variantId: v.id, qty, unitCost: prod.cost });
      }
      await retotal(po.id);
      result = po.number;
      await logActivity(who(p), { area: 'procurement', kind: 'rec_accepted', refType: 'po', refId: po.id, message: `Added ${num(Number(payload.qty))} × ${prod.title} to ${po.number}` });
      break;
    }
    case 'transfer': {
      need(p, 'stock', 2, 'Moving stock between places');
      const t = await makeTransfer(p, String(payload.from), String(payload.to), payload.lines as { productId: string; qty: number }[], r.body.split('. ')[0], 'ai');
      result = t.number;
      break;
    }
    case 'markdown': {
      if (!can(p, 'stock', 3) && !can(p, 'merch', 3)) throw forbidden('Changing a price needs stock or merchandising manager access.');
      const [prod] = await db.select().from(schema.products).where(eq(schema.products.id, r.productId!));
      if (!prod) throw notFound();
      const newPrice = Number(payload.newPrice);
      await db.update(schema.products).set({ compareAt: prod.price, price: newPrice }).where(eq(schema.products.id, prod.id));
      const where = (payload.locations as { id: string; units: number }[]) ?? [];
      for (const l of where) {
        await createTask({ kind: 'relabel', title: `Re-ticket ${prod.title} to ${money(newPrice, prod.currency)}`, detail: `${Math.round(Number(payload.depth) * 100)}% off, was ${money(prod.price, prod.currency)}. Replace every ticket and move the rail to the sale area.`, locationId: l.id, units: l.units, dueAt: new Date(Date.now() + 2 * 86_400_000), priority: 3, refType: 'product', refId: prod.id, source: 'ai', by: who(p) });
      }
      result = `${where.length} re-ticketing task${where.length === 1 ? '' : 's'}`;
      status = 'done';
      await logActivity(who(p), { area: 'stock', kind: 'markdown', refType: 'product', refId: prod.id, message: `Marked ${prod.title} down ${Math.round(Number(payload.depth) * 100)}% to ${money(newPrice, prod.currency)}` });
      break;
    }
    case 'cross_sell':
    case 'upsell':
    case 'popup':
    case 'bundle': {
      need(p, 'merch', 2, 'Website placements');
      const live = opts.publish !== false && can(p, 'merch', 3) && p.id !== PLANNER_ID;
      const [pl] = await db
        .insert(schema.placements)
        .values({
          number: await nextNumber('placement'),
          kind: r.kind,
          status: live ? 'live' : 'draft',
          market: r.market,
          channels: opts.channels ?? (payload.channels as string[]) ?? [],
          anchors: (payload.anchors as string[]) ?? [],
          items: (payload.items as string[]) ?? [],
          headline: opts.headline ?? String(payload.headline ?? 'You may also like'),
          headlineAr: opts.headlineAr ?? (payload.headlineAr as string | undefined) ?? null,
          offer: opts.offer ?? (payload.offer as string | undefined) ?? null,
          startsAt: live ? new Date() : null,
          recommendationId: r.id,
          createdBy: p.id,
          createdByName: p.name,
          approvedBy: live ? p.id : null,
          approvedByName: live ? p.name : null,
          approvedAt: live ? new Date() : null,
        })
        .returning();
      result = pl.number;
      if (live) status = 'done';
      await logActivity(who(p), { area: 'merch', kind: live ? 'published' : 'proposed', refType: 'placement', refId: pl.id, message: live ? `Published ${pl.number} “${pl.headline}” on ${pl.channels.length} website${pl.channels.length === 1 ? '' : 's'}` : `Proposed ${pl.number} “${pl.headline}” for publishing` });
      break;
    }
    case 'count': {
      if (!can(p, 'warehouse', 2) && !can(p, 'stock', 2)) throw forbidden();
      const ids = (payload.productIds as string[]) ?? [];
      const t = await createTask({ kind: 'cycle_count', title: `Count ${ids.length} styles`, detail: 'Count every size on the shelf and in the back. Enter what you find; differences are booked as count adjustments.', locationId: String(payload.locationId), units: Number(payload.units) || 0, dueAt: new Date(Date.now() + 2 * 86_400_000), priority: r.priority <= 2 ? 2 : 3, refType: 'count', refId: r.id, source: 'ai', by: who(p) });
      await db.update(schema.tasks).set({ result: { productIds: ids } }).where(eq(schema.tasks.id, t.id));
      result = t.number;
      break;
    }
    case 'expedite': {
      need(p, 'procurement', 2, 'Chasing a supplier');
      const t = await createTask({ kind: 'supplier_followup', title: r.title, detail: r.body, units: 0, dueAt: new Date(Date.now() + 6 * 3_600_000), priority: 1, refType: 'po', refId: String(payload.poId), source: 'ai', by: who(p), assigneeId: p.id });
      result = t.number;
      break;
    }
    default:
      throw invalid('This kind of proposal cannot be accepted here.');
  }

  await db.update(schema.recommendations).set({ status, decidedBy: p.id, decidedByName: p.name, decidedAt: new Date(), resultRef: result, updatedAt: new Date() }).where(eq(schema.recommendations.id, id));
  return done(`${r.kind === 'reorder' ? 'Added to' : 'Done:'} ${result}`);
}

export async function dismissRecommendation(p: P, id: string, reason: string) {
  const db = await getDb();
  const [r] = await db.select().from(schema.recommendations).where(eq(schema.recommendations.id, id));
  if (!r) throw notFound();
  if (!can(p, r.area as Area, 2)) throw forbidden();
  if (r.status !== 'open') throw invalid('Already decided.');
  await db.update(schema.recommendations).set({ status: 'dismissed', decidedBy: p.id, decidedByName: p.name, decidedAt: new Date(), resultRef: reason.slice(0, 200) || null }).where(eq(schema.recommendations.id, id));
  await logActivity(who(p), { area: r.area, kind: 'rec_dismissed', refType: 'rec', refId: id, message: `Dismissed “${r.title}”${reason ? `: ${reason}` : ''}` });
  return done('Dismissed. The planner will not raise it again for two weeks.');
}

// ── Purchase orders ───────────────────────────────────────────────────────────────────────────

async function draftPoFor(p: P, supplierId: string, locationId: string, market: string, company: string, currency: string, source: 'ai' | 'manual', reason: string) {
  const db = await getDb();
  const [open] = await db
    .select()
    .from(schema.purchaseOrders)
    .where(and(eq(schema.purchaseOrders.supplierId, supplierId), eq(schema.purchaseOrders.locationId, locationId), eq(schema.purchaseOrders.status, 'draft')))
    .orderBy(desc(schema.purchaseOrders.createdAt))
    .limit(1);
  if (open) return open;
  const [s] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, supplierId));
  const [po] = await db
    .insert(schema.purchaseOrders)
    .values({
      number: await nextNumber('po'),
      supplierId,
      locationId,
      company,
      market,
      currency,
      status: 'draft',
      source,
      reason,
      expectedAt: new Date(Date.now() + (s?.leadDays ?? 42) * 86_400_000),
      createdBy: p.id,
      createdByName: p.name,
    })
    .returning();
  await logActivity(who(p), { area: 'procurement', kind: 'po_created', refType: 'po', refId: po.id, message: `Started ${po.number} for ${s?.name ?? 'a supplier'}` });
  return po;
}

async function retotal(poId: string) {
  const db = await getDb();
  await db.execute(sql`
    update purchase_orders set
      total = coalesce((select sum(qty * unit_cost) from po_lines where po_id = ${poId}), 0),
      units = coalesce((select sum(qty) from po_lines where po_id = ${poId}), 0),
      updated_at = now()
    where id = ${poId}`);
}

export async function createPo(p: P, i: { supplierId: string; market: string; note?: string }) {
  need(p, 'procurement', 2, 'Starting a purchase order');
  const db = await getDb();
  const wh = await warehouseOf(i.market);
  const [s] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, i.supplierId));
  if (!s) throw notFound('Supplier not found.');
  const company = i.market === 'EG' ? 'FIG' : s.brands.some((b) => /vie en rose|hunkem|bebe|bimba/i.test(b)) ? 'DCO' : 'DH';
  const po = await draftPoFor(p, s.id, wh.id, i.market, company, wh.currency, 'manual', i.note ?? `Started by ${p.name}`);
  done(`${po.number} started`);
  return po;
}

export async function addPoLines(p: P, poId: string, productId: string, qty: number) {
  need(p, 'procurement', 2, 'Editing a purchase order');
  const db = await getDb();
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, poId));
  if (!po) throw notFound();
  if (po.status !== 'draft') throw invalid('Only a draft can be edited. Send it back to draft first.');
  const [prod] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
  if (!prod || prod.market !== po.market) throw invalid('That style is not sold in this market.');
  const vars = await db.select().from(schema.variants).where(eq(schema.variants.productId, prod.id)).orderBy(asc(schema.variants.sizeIdx));
  const split = splitSizes(qty, vars.map((v) => v.size ?? ''), prod.sizeMix);
  for (const v of vars) {
    const n = split[v.size ?? ''] ?? 0;
    if (!n) continue;
    const [line] = await db.select().from(schema.poLines).where(and(eq(schema.poLines.poId, po.id), eq(schema.poLines.variantId, v.id)));
    if (line) await db.update(schema.poLines).set({ qty: line.qty + n }).where(eq(schema.poLines.id, line.id));
    else await db.insert(schema.poLines).values({ poId: po.id, productId: prod.id, variantId: v.id, qty: n, unitCost: prod.cost });
  }
  await retotal(po.id);
  await logActivity(who(p), { area: 'procurement', kind: 'po_edit', refType: 'po', refId: po.id, message: `Added ${num(qty)} × ${prod.title} to ${po.number}` });
  return done('Added');
}

export async function setPoLine(p: P, lineId: string, qty: number) {
  need(p, 'procurement', 2, 'Editing a purchase order');
  const db = await getDb();
  const [line] = await db.select().from(schema.poLines).where(eq(schema.poLines.id, lineId));
  if (!line) throw notFound();
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, line.poId));
  if (po.status !== 'draft') throw invalid('Only a draft can be edited.');
  if (qty <= 0) await db.delete(schema.poLines).where(eq(schema.poLines.id, lineId));
  else await db.update(schema.poLines).set({ qty: Math.round(qty) }).where(eq(schema.poLines.id, lineId));
  await retotal(po.id);
  return done('Updated');
}

export async function movePo(p: P, poId: string, to: PoStatus, note?: string) {
  const db = await getDb();
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, poId));
  if (!po) throw notFound();
  const step = poStep(po.status as PoStatus, to);
  if (!step) throw invalid(`A purchase order that is ${PO_STATUS[po.status as PoStatus].label.toLowerCase()} can’t be ${PO_STATUS[to].label.toLowerCase()}.`);
  const rules = await stockRules();
  const lvl = level(p, 'procurement');
  // approving below the limit is the buyer's own call; above it, it waits for an approver
  let target = to;
  if (po.status === 'draft' && to === 'approval' && !needsSecondSignature(egpMinor(po.total, po.currency), rules.approvalLimit, lvl)) target = 'approved';
  // the AI submits; a person signs
  if (p.id === PLANNER_ID && target === 'approved') target = 'approval';
  if (lvl < step.min && !(to === 'approval' && target === 'approved' && lvl >= 2)) throw forbidden(`${step.label} needs ${step.min === 3 ? 'approval' : 'buying'} rights.`);
  if (target !== 'cancelled' && target !== 'draft' && po.units <= 0) throw invalid('Add at least one line first.');
  const now = new Date();
  const patch: Partial<typeof schema.purchaseOrders.$inferInsert> = { status: target, updatedAt: now };
  if (target === 'approved') Object.assign(patch, { approvedBy: p.id, approvedByName: p.name, approvedAt: now });
  if (target === 'sent') {
    const [s] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, po.supplierId));
    Object.assign(patch, { sentAt: now, expectedAt: new Date(now.getTime() + (s?.leadDays ?? 42) * 86_400_000) });
  }
  if (target === 'confirmed') patch.confirmedAt = now;
  if (target === 'closed' || target === 'cancelled') patch.closedAt = now;
  if (note) patch.note = note;
  await db.update(schema.purchaseOrders).set(patch).where(eq(schema.purchaseOrders.id, po.id));
  if (target === 'sent') await db.update(schema.recommendations).set({ status: 'done', updatedAt: now }).where(and(eq(schema.recommendations.resultRef, po.number), eq(schema.recommendations.status, 'accepted')));
  if (target === 'confirmed' || target === 'cancelled') {
    await db.update(schema.tasks).set({ status: 'done', doneAt: now }).where(and(eq(schema.tasks.refId, po.id), eq(schema.tasks.kind, 'supplier_followup'), inArray(schema.tasks.status, ['open', 'doing'])));
  }
  const label = target === 'approved' && to === 'approval' ? 'Approved (under the limit)' : PO_STATUS[target].label;
  await logActivity(who(p), { area: 'procurement', kind: `po_${target}`, refType: 'po', refId: po.id, message: `${po.number}: ${label}${note ? ` · ${note}` : ''}`, data: { total: po.total, currency: po.currency } });
  return done(`${po.number}: ${label}`);
}

/** The warehouse books in what arrived: good pieces to stock, damaged ones recorded. */
export async function receivePo(p: P, poId: string, lines: { lineId: string; good: number; damaged: number }[]) {
  if (!can(p, 'warehouse', 2) && !can(p, 'procurement', 2)) throw forbidden('Receiving needs warehouse access.');
  const db = await getDb();
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, poId));
  if (!po) throw notFound();
  if (!['sent', 'confirmed', 'partial'].includes(po.status)) throw invalid('This purchase order is not expected.');
  const now = new Date();
  let good = 0;
  let bad = 0;
  for (const l of lines) {
    if (l.good <= 0 && l.damaged <= 0) continue;
    const [row] = await db.select().from(schema.poLines).where(and(eq(schema.poLines.id, l.lineId), eq(schema.poLines.poId, po.id)));
    if (!row) continue;
    await db.update(schema.poLines).set({ received: row.received + l.good, damaged: row.damaged + l.damaged }).where(eq(schema.poLines.id, row.id));
    if (l.good > 0) await postMove({ at: now, variantId: row.variantId, productId: row.productId, locationId: po.locationId, qty: l.good, kind: 'receive', refType: 'po', refId: po.id, actorId: p.id, actorName: p.name, note: po.number });
    good += Math.max(0, l.good);
    bad += Math.max(0, l.damaged);
  }
  if (!good && !bad) throw invalid('Enter what arrived.');
  const [{ left }] = (await db.execute<{ left: number }>(sql`select coalesce(sum(greatest(qty - received - damaged, 0)), 0)::int as left from po_lines where po_id = ${po.id}`)).rows;
  const status: PoStatus = left > 0 ? 'partial' : 'received';
  await db.update(schema.purchaseOrders).set({ status, receivedAt: status === 'received' ? now : po.receivedAt, updatedAt: now }).where(eq(schema.purchaseOrders.id, po.id));
  // the receiving task is done; putting the pieces away is the next one
  const [task] = await db.select().from(schema.tasks).where(and(eq(schema.tasks.refId, po.id), eq(schema.tasks.kind, 'receive'), inArray(schema.tasks.status, ['open', 'doing'])));
  if (task) await finishRow(task, now, p.id);
  await createTask({ kind: 'putaway', title: `Put away ${num(good)} pieces from ${po.number}`, detail: 'Shelve by bay; fast movers to the pick face first.', locationId: po.locationId, units: good, dueAt: new Date(now.getTime() + 8 * 3_600_000), priority: 2, refType: 'po', refId: po.id, source: 'system', by: who(p), assigneeId: task?.assigneeId ?? null });
  await logActivity(who(p), { area: 'warehouse', kind: 'received', refType: 'po', refId: po.id, message: `Received ${num(good)} pieces of ${po.number}${bad ? `, ${bad} damaged` : ''}${left ? `; ${num(left)} still to come` : ''}` });
  return done(`${po.number}: ${num(good)} in stock${left ? `, ${num(left)} to come` : ''}`);
}

// ── Transfers ─────────────────────────────────────────────────────────────────────────────────

async function makeTransfer(p: P, from: string, to: string, lines: { productId: string; qty: number }[], reason: string, source: 'ai' | 'manual') {
  const db = await getDb();
  const [a, b] = await Promise.all([db.select().from(schema.locations).where(eq(schema.locations.id, from)), db.select().from(schema.locations).where(eq(schema.locations.id, to))]);
  if (!a[0] || !b[0]) throw invalid('Unknown place.');
  if (a[0].country !== b[0].country) throw invalid('Transfers stay inside one country.');
  const [t] = await db.insert(schema.transfers).values({ number: await nextNumber('transfer'), fromId: from, toId: to, status: 'proposed', reason, source, createdBy: p.id, createdByName: p.name }).returning();
  let units = 0;
  for (const l of lines) {
    // take the sizes the source actually has, biggest piles first
    const levels = await db.select().from(schema.stockLevels).where(and(eq(schema.stockLevels.productId, l.productId), eq(schema.stockLevels.locationId, from))).orderBy(desc(schema.stockLevels.onHand));
    const total = levels.reduce((s, x) => s + Math.max(0, x.onHand), 0);
    let left = Math.min(l.qty, total);
    for (const lv of levels) {
      if (left <= 0) break;
      const take = Math.min(lv.onHand, Math.max(1, Math.round((l.qty * lv.onHand) / Math.max(1, total))), left);
      if (take <= 0) continue;
      await db.insert(schema.transferLines).values({ transferId: t.id, productId: l.productId, variantId: lv.variantId, qty: take });
      left -= take;
      units += take;
    }
  }
  if (!units) {
    await db.delete(schema.transfers).where(eq(schema.transfers.id, t.id));
    throw invalid('The source no longer has those pieces.');
  }
  await db.update(schema.transfers).set({ units }).where(eq(schema.transfers.id, t.id));
  await createTask({ kind: 'transfer_pick', title: `Pick ${t.number}: ${num(units)} pieces for ${b[0].name}`, detail: reason, locationId: from, units, dueAt: new Date(Date.now() + 86_400_000), priority: 3, refType: 'transfer', refId: t.id, source: source === 'ai' ? 'ai' : 'manual', by: who(p) });
  await logActivity(who(p), { area: 'stock', kind: 'transfer_created', refType: 'transfer', refId: t.id, message: `${t.number}: ${num(units)} pieces from ${a[0].name} to ${b[0].name}` });
  return { ...t, units };
}

export async function createTransfer(p: P, from: string, to: string, lines: { productId: string; qty: number }[], reason: string) {
  need(p, 'stock', 2, 'Moving stock');
  const t = await makeTransfer(p, from, to, lines, reason, 'manual');
  done(`${t.number} created`);
  return t;
}

export async function moveTransfer(p: P, id: string, to: TransferStatus) {
  if (!can(p, 'warehouse', 2) && !can(p, 'stock', 2)) throw forbidden();
  const db = await getDb();
  const [t] = await db.select().from(schema.transfers).where(eq(schema.transfers.id, id));
  if (!t) throw notFound();
  if (!TRANSFER_FLOW[t.status as TransferStatus].includes(to)) throw invalid(`A transfer that is ${TRANSFER_STATUS[t.status as TransferStatus].label.toLowerCase()} can’t go to ${TRANSFER_STATUS[to].label.toLowerCase()}.`);
  const now = new Date();
  const lines = await db.select().from(schema.transferLines).where(eq(schema.transferLines.transferId, id));
  const [src] = await db.select().from(schema.locations).where(eq(schema.locations.id, t.fromId));
  if (to === 'in_transit') {
    for (const l of lines) await postMove({ at: now, variantId: l.variantId, productId: l.productId, locationId: t.fromId, qty: -l.qty, kind: 'transfer_out', refType: 'transfer', refId: t.id, actorId: p.id, actorName: p.name, note: t.number });
    await finishOpen('transfer_pick', t.id, now, p.id);
    await createTask({ kind: 'transfer_receive', title: `Receive ${t.number}: ${num(t.units)} pieces`, detail: `On the way from ${src?.name ?? t.fromId}. Check every piece against the list.`, locationId: t.toId, units: t.units, dueAt: new Date(now.getTime() + 2 * 86_400_000), priority: 3, refType: 'transfer', refId: t.id, source: 'system', by: who(p) });
    await db.update(schema.transfers).set({ status: to, shippedAt: now }).where(eq(schema.transfers.id, id));
  } else if (to === 'received') {
    for (const l of lines) {
      await postMove({ at: now, variantId: l.variantId, productId: l.productId, locationId: t.toId, qty: l.qty, kind: 'transfer_in', refType: 'transfer', refId: t.id, actorId: p.id, actorName: p.name, note: t.number });
      await db.update(schema.transferLines).set({ received: l.qty }).where(eq(schema.transferLines.id, l.id));
    }
    await finishOpen('transfer_receive', t.id, now, p.id);
    await db.update(schema.transfers).set({ status: to, receivedAt: now }).where(eq(schema.transfers.id, id));
    await db.update(schema.recommendations).set({ status: 'done', updatedAt: now }).where(and(eq(schema.recommendations.resultRef, t.number), eq(schema.recommendations.status, 'accepted')));
  } else {
    if (to === 'cancelled') await db.update(schema.tasks).set({ status: 'cancelled' }).where(and(eq(schema.tasks.refId, t.id), inArray(schema.tasks.status, ['open', 'doing', 'blocked'])));
    await db.update(schema.transfers).set({ status: to }).where(eq(schema.transfers.id, id));
  }
  await logActivity(who(p), { area: 'warehouse', kind: `transfer_${to}`, refType: 'transfer', refId: t.id, message: `${t.number}: ${TRANSFER_STATUS[to].label}` });
  return done(`${t.number}: ${TRANSFER_STATUS[to].label}`);
}

// ── Tasks ─────────────────────────────────────────────────────────────────────────────────────

async function finishRow(t: typeof schema.tasks.$inferSelect, now: Date, by: string) {
  const db = await getDb();
  const spent = t.startedAt ? Math.max(1, Math.round((now.getTime() - t.startedAt.getTime()) / 60_000)) : t.estMinutes;
  await db.update(schema.tasks).set({ status: 'done', doneAt: now, spentMinutes: spent, startedAt: t.startedAt ?? new Date(now.getTime() - spent * 60_000), assigneeId: t.assigneeId ?? by }).where(eq(schema.tasks.id, t.id));
}

async function finishOpen(kind: TaskKind, refId: string, now: Date, by: string) {
  const db = await getDb();
  const open = await db.select().from(schema.tasks).where(and(eq(schema.tasks.kind, kind), eq(schema.tasks.refId, refId), inArray(schema.tasks.status, ['open', 'doing'])));
  for (const t of open) await finishRow(t, now, by);
}

async function taskFor(p: P, id: string) {
  const db = await getDb();
  const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  if (!t) throw notFound('Task not found.');
  const area = t.area as Area;
  const mine = t.assigneeId === p.id;
  if (!can(p, area, 2)) throw forbidden();
  if (!mine && t.assigneeId && !can(p, area, 3)) throw forbidden('This task belongs to someone else.');
  return t;
}

export async function startTask(p: P, id: string) {
  const db = await getDb();
  const t = await taskFor(p, id);
  if (t.status === 'done' || t.status === 'cancelled') throw invalid('This task is finished.');
  // one thing at a time: whatever else they were doing goes back to the queue, time kept
  const doing = await db.select().from(schema.tasks).where(and(eq(schema.tasks.assigneeId, t.assigneeId ?? p.id), eq(schema.tasks.status, 'doing')));
  for (const d of doing) if (d.id !== t.id) await db.update(schema.tasks).set({ status: 'open' }).where(eq(schema.tasks.id, d.id));
  await db.update(schema.tasks).set({ status: 'doing', startedAt: t.startedAt ?? new Date(), assigneeId: t.assigneeId ?? p.id, blockedReason: null }).where(eq(schema.tasks.id, id));
  await logActivity(who(p), { area: t.area, kind: 'task_started', refType: 'task', refId: t.id, message: `Started ${t.number}: ${t.title}` });
  return done(`Started ${t.number}`);
}

export async function finishTask(p: P, id: string, note?: string) {
  const db = await getDb();
  const t = await taskFor(p, id);
  if (t.status === 'done') throw invalid('Already done.');
  const now = new Date();
  // finishing the job is what moves the thing it was about
  if (t.kind === 'transfer_pick' && t.refId) {
    const [tr] = await db.select().from(schema.transfers).where(eq(schema.transfers.id, t.refId));
    if (tr?.status === 'proposed') await db.update(schema.transfers).set({ status: 'picking' }).where(eq(schema.transfers.id, tr.id));
    if (tr && ['proposed', 'picking'].includes(tr.status)) return moveTransfer(p, tr.id, 'in_transit');
  }
  if (t.kind === 'transfer_receive' && t.refId) {
    const [tr] = await db.select().from(schema.transfers).where(eq(schema.transfers.id, t.refId));
    if (tr?.status === 'in_transit') return moveTransfer(p, tr.id, 'received');
  }
  if (t.kind === 'receive' && t.refType === 'po' && t.refId) {
    const lines = await db.select().from(schema.poLines).where(eq(schema.poLines.poId, t.refId));
    const due = lines.map((l) => ({ lineId: l.id, good: Math.max(0, l.qty - l.received - l.damaged), damaged: 0 })).filter((l) => l.good > 0);
    if (due.length) return receivePo(p, t.refId, due);
  }
  if (t.kind === 'cycle_count' && t.locationId) {
    const ids = ((t.result as { productIds?: string[] } | null)?.productIds ?? []).filter(Boolean);
    if (ids.length) await db.update(schema.stockLevels).set({ countedAt: now }).where(and(eq(schema.stockLevels.locationId, t.locationId), inArray(schema.stockLevels.productId, ids)));
    if (t.refType === 'count' && t.refId) await db.update(schema.recommendations).set({ status: 'done', updatedAt: now }).where(eq(schema.recommendations.id, t.refId));
  }
  await finishRow({ ...t, assigneeId: t.assigneeId ?? p.id }, now, p.id);
  if (note) await db.update(schema.tasks).set({ result: { ...(t.result ?? {}), note } }).where(eq(schema.tasks.id, t.id));
  await logActivity(who(p), { area: t.area, kind: 'task_done', refType: 'task', refId: t.id, message: `${TASK_KIND[t.kind as TaskKind]?.verb ?? 'Finished'}: ${t.title}${note ? ` · ${note}` : ''}`, data: { units: t.units } });
  return done(`${t.number} done`);
}

export async function blockTask(p: P, id: string, reason: string) {
  const db = await getDb();
  const t = await taskFor(p, id);
  if (!reason.trim()) throw invalid('Say what is in the way.');
  await db.update(schema.tasks).set({ status: 'blocked', blockedReason: reason.trim().slice(0, 300) }).where(eq(schema.tasks.id, id));
  await logActivity(who(p), { area: t.area, kind: 'task_blocked', refType: 'task', refId: t.id, message: `Blocked ${t.number}: ${reason.trim()}` });
  return done(`${t.number} flagged as blocked`);
}

export async function assignTask(p: P, id: string, userId: string | null) {
  const db = await getDb();
  const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  if (!t) throw notFound();
  const area = t.area as Area;
  const self = userId === p.id && !t.assigneeId && can(p, area, 2);
  if (!self && !can(p, area, 3)) throw forbidden('Handing out work needs the manager level.');
  await db.update(schema.tasks).set({ assigneeId: userId, status: t.status === 'doing' ? 'open' : t.status }).where(eq(schema.tasks.id, id));
  const [u] = userId ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId)) : [];
  await logActivity(who(p), { area: t.area, kind: 'task_assigned', refType: 'task', refId: t.id, message: u ? `${t.number} → ${u.name}` : `${t.number} unassigned` });
  return done(u ? `${t.number} is with ${u.name.split(' ')[0]}` : 'Unassigned');
}

export async function addTask(p: P, i: { kind: TaskKind; title: string; detail?: string; locationId?: string | null; units?: number; dueAt?: Date | null; priority?: number; assigneeId?: string | null }) {
  const area = TASK_KIND[i.kind].area;
  need(p, area, 2, 'Adding a task');
  if (i.assigneeId && i.assigneeId !== p.id && !can(p, area, 3)) throw forbidden('Giving work to someone else needs the manager level.');
  if (!i.title.trim()) throw invalid('Give the task a title.');
  const t = await createTask({ ...i, title: i.title.trim(), source: 'manual', by: who(p) });
  await logActivity(who(p), { area, kind: 'task_created', refType: 'task', refId: t.id, message: `Added ${t.number}: ${t.title}` });
  done(`${t.number} added`);
  return t;
}

/** Hands every waiting task out again so nobody sits idle while someone else has a queue. */
export async function rebalanceWork(p: P, area: 'warehouse' | 'procurement' | 'merch') {
  need(p, area, 3, 'Rebalancing the work');
  const db = await getDb();
  const open = await db.select().from(schema.tasks).where(and(eq(schema.tasks.area, area), eq(schema.tasks.status, 'open'))).orderBy(asc(schema.tasks.priority), asc(schema.tasks.dueAt));
  await db.update(schema.tasks).set({ assigneeId: null }).where(inArray(schema.tasks.id, open.length ? open.map((t) => t.id) : ['-']));
  let moved = 0;
  const locs = await db.select({ id: schema.locations.id, country: schema.locations.country }).from(schema.locations);
  for (const t of open) {
    const people = await candidatesFor(area);
    const to = pickAssignee({ kind: t.kind as TaskKind, locationId: t.locationId, country: locs.find((l) => l.id === t.locationId)?.country ?? null, estMinutes: t.estMinutes }, people, Date.now());
    await db.update(schema.tasks).set({ assigneeId: to }).where(eq(schema.tasks.id, t.id));
    if (to !== t.assigneeId) moved++;
  }
  await logActivity(who(p), { area, kind: 'rebalanced', message: `Rebalanced ${open.length} waiting ${area} tasks; ${moved} changed hands` });
  return done(`${moved} of ${open.length} tasks changed hands`);
}

// ── Stock on hand ─────────────────────────────────────────────────────────────────────────────

export async function adjustStock(p: P, i: { variantId: string; locationId: string; delta: number; reason: string }) {
  need(p, 'stock', 2, 'Adjusting stock');
  if (!i.delta || !Number.isFinite(i.delta)) throw invalid('Enter how many pieces to add or take off.');
  if (!i.reason.trim()) throw invalid('Give a reason: damaged, found, lost, sample…');
  const db = await getDb();
  const [v] = await db.select().from(schema.variants).where(eq(schema.variants.id, i.variantId));
  if (!v) throw notFound();
  await postMove({ variantId: v.id, productId: v.productId, locationId: i.locationId, qty: Math.round(i.delta), kind: i.delta < 0 && /damag/i.test(i.reason) ? 'damage' : 'adjust', actorId: p.id, actorName: p.name, note: i.reason.trim() });
  await logActivity(who(p), { area: 'stock', kind: 'adjust', refType: 'variant', refId: v.id, message: `${i.delta > 0 ? '+' : ''}${i.delta} × ${v.sku} at ${i.locationId}: ${i.reason.trim()}` });
  return done('Stock adjusted');
}

// ── Website placements ────────────────────────────────────────────────────────────────────────

export async function setPlacement(p: P, id: string, to: 'live' | 'paused' | 'ended') {
  need(p, 'merch', to === 'live' ? 3 : 2, to === 'live' ? 'Publishing to the websites' : 'Pausing a placement');
  const db = await getDb();
  const [pl] = await db.select().from(schema.placements).where(eq(schema.placements.id, id));
  if (!pl) throw notFound();
  const now = new Date();
  await db
    .update(schema.placements)
    .set({ status: to, ...(to === 'live' ? { startsAt: pl.startsAt ?? now, approvedBy: p.id, approvedByName: p.name, approvedAt: now } : {}), ...(to === 'ended' ? { endsAt: now } : {}) })
    .where(eq(schema.placements.id, id));
  if (to === 'live' && pl.recommendationId) await db.update(schema.recommendations).set({ status: 'done', updatedAt: now }).where(eq(schema.recommendations.id, pl.recommendationId));
  await logActivity(who(p), { area: 'merch', kind: `placement_${to}`, refType: 'placement', refId: pl.id, message: `${pl.number} “${pl.headline}”: ${to === 'live' ? 'published' : to}` });
  return done(`${pl.number} ${to === 'live' ? 'is live' : to}`);
}

export async function editPlacement(p: P, id: string, i: { headline?: string; headlineAr?: string; offer?: string | null; channels?: string[] }) {
  need(p, 'merch', 2, 'Editing a placement');
  const db = await getDb();
  await db
    .update(schema.placements)
    .set({ ...(i.headline ? { headline: i.headline.slice(0, 80) } : {}), ...(i.headlineAr !== undefined ? { headlineAr: i.headlineAr.slice(0, 80) } : {}), ...(i.offer !== undefined ? { offer: i.offer?.slice(0, 60) ?? null } : {}), ...(i.channels ? { channels: i.channels } : {}) })
    .where(eq(schema.placements.id, id));
  return done('Saved');
}

// ── Setup ─────────────────────────────────────────────────────────────────────────────────────

export async function saveStockRules(p: P, rules: StockRules) {
  need(p, 'stock', 3, 'Changing how the AI works');
  const { putSetting } = await import('../engine');
  await putSetting('stock.rules', rules, p.name);
  await logActivity(who(p), { area: 'stock', kind: 'rules', message: `Set the AI to “${rules.autonomy}”; approval limit ${money(rules.approvalLimit, 'EGP')}` });
  return done('Saved');
}

export async function addLocation(p: P, i: { name: string; kind: 'warehouse' | 'store'; company: 'DH' | 'DCO' | 'FIG'; country: string; city?: string; area?: string; brands: string[] }) {
  need(p, 'stock', 3, 'Adding a store or warehouse');
  if (!i.name.trim()) throw invalid('Name it.');
  const c = COUNTRIES.find((x) => x.code === i.country);
  if (!c) throw invalid('Pick a country.');
  const db = await getDb();
  const id = i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `loc-${Date.now()}`;
  const [exists] = await db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.id, id));
  if (exists) throw invalid('There is already a place with that name.');
  await db.insert(schema.locations).values({ id, kind: i.kind, name: i.name.trim(), company: i.company, country: c.code, currency: c.currency, city: i.city ?? null, area: i.area ?? null, brands: i.brands, source: 'setup' });
  await logActivity(who(p), { area: 'stock', kind: 'location_added', refType: 'location', refId: id, message: `Added ${i.kind} ${i.name.trim()}` });
  return done(`${i.name.trim()} added`);
}

export async function addSupplier(p: P, i: { name: string; country: string; currency: string; brands: string[]; leadDays: number; moq: number; casePack: number; paymentTerms?: string; contactName?: string; contactEmail?: string }) {
  need(p, 'procurement', 3, 'Adding a supplier');
  if (!i.name.trim()) throw invalid('Name the supplier.');
  if (!(i.leadDays > 0)) throw invalid('Give the lead time in days.');
  const db = await getDb();
  const [s] = await db.insert(schema.suppliers).values({ name: i.name.trim(), country: i.country, currency: i.currency, brands: i.brands, leadDays: Math.round(i.leadDays), moq: Math.max(0, Math.round(i.moq)), casePack: Math.max(1, Math.round(i.casePack)), paymentTerms: i.paymentTerms ?? null, contactName: i.contactName ?? null, contactEmail: i.contactEmail ?? null, source: 'setup' }).returning();
  await logActivity(who(p), { area: 'procurement', kind: 'supplier_added', refType: 'supplier', refId: s.id, message: `Added supplier ${s.name}` });
  return done(`${s.name} added`);
}

/**
 * A new website or app. Its definition is kept in the channels table and joins the shipped list at
 * once; credentials go in the server environment under RELAY_<PREFIX>_*, never here.
 */
export async function addStorefront(p: P, i: { name: string; brand: string; surface: 'Website' | 'App'; platform: Platform; country: Country; company: 'DH' | 'DCO' | 'FIG'; domain?: string; store?: string; baseUrl?: string; warehouse: string }) {
  if (!can(p, 'channels', 3)) throw forbidden('Adding a storefront needs channel manager access.');
  const name = i.name.trim();
  const brand = i.brand.trim();
  if (!name || !brand) throw invalid('Give it a name and a brand.');
  const c = COUNTRIES.find((x) => x.code === i.country);
  if (!c) throw invalid('Pick a country.');
  if (i.platform === 'shopify' && !/^[a-z0-9-]+$/.test(i.store ?? '')) throw invalid('Give the Shopify handle: the part before .myshopify.com.');
  if (i.platform !== 'shopify' && !/^https:\/\//.test(i.baseUrl ?? '')) throw invalid('Give the store’s https address.');
  const db = await getDb();
  const [wh] = await db.select().from(schema.locations).where(and(eq(schema.locations.id, i.warehouse), eq(schema.locations.kind, 'warehouse')));
  if (!wh) throw invalid('Pick the warehouse it ships from.');
  const base = `${brand}-${i.surface === 'App' ? 'app' : 'web'}-${c.code}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let id = base;
  for (let n = 2; CHANNEL[id]; n++) id = `${base}-${n}`;
  const def: ChannelDef = {
    id,
    envPrefix: envPrefixFor(id),
    brand,
    name,
    surface: i.surface,
    platform: i.platform,
    country: c.code,
    currency: c.currency,
    company: i.company,
    domain: i.domain?.replace(/^https?:\/\//, '').replace(/\/$/, '') || undefined,
    store: i.platform === 'shopify' ? i.store : undefined,
    baseUrl: i.platform === 'shopify' ? undefined : i.baseUrl,
    warehouse: wh.id,
    carrier: c.code === 'EG' ? 'Aramex' : `Aramex ${c.code}`,
    custom: true,
  };
  await db.insert(schema.channels).values({ id, mode: 'off', custom: true, config: def });
  registerChannels([def]);
  await logActivity(who(p), { area: 'channels', kind: 'storefront_added', refType: 'channel', refId: id, message: `Added ${name} (${i.platform}, ${c.name})` });
  return done(`${name} added. Set RELAY_${def.envPrefix}_* on the server to connect it.`);
}
