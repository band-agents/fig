import 'server-only';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { level, type Principal } from '../../domain/perms';
import { PO_FLOW, PO_STATUS, PO_TRACK, type PoStatus } from '../../domain/stock/flows';
import { money, moneyIn } from '../../format';
import { egpMinor, stockRules } from '../core';
import { getFacts } from '../facts';
import { inMarkets, marketsFor, poOfBrands, sees, viewCurrency } from './common';
import { openRecs } from './recs';

const fmtDay = (d: Date | string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(d));

/** The AI's reorder plan, one block per supplier and market, the most urgent supplier first. */
export async function buyPlan(p: Principal) {
  const s = sees(p);
  const recs = await openRecs(p, { areas: ['procurement'] });
  const facts = await getFacts();
  const db = await getDb();
  const sups = await db.select().from(schema.suppliers);
  const groups = new Map<string, { key: string; supplierId: string; supplier: string; country: string; market: string; leadDays: number; lines: typeof recs; units: number; cost: number; risk: number; urgent: number; orderBy: string | null }>();
  for (const r of recs.filter((x) => x.kind === 'reorder')) {
    const sid = (r.payload.supplierId as string | undefined) ?? facts.byId.get(r.product?.id ?? '')?.supplierId;
    const sup = sups.find((x) => x.id === sid);
    const k = `${sup?.id ?? 'none'}|${r.market}`;
    const g = groups.get(k) ?? { key: k, supplierId: sup?.id ?? '', supplier: sup?.name ?? 'No supplier set', country: sup?.country ?? '', market: r.market, leadDays: sup?.leadDays ?? 42, lines: [], units: 0, cost: 0, risk: 0, urgent: 0, orderBy: null };
    g.lines.push(r);
    g.units += Number(r.payload.qty ?? 0);
    const fx = facts.byId.get(r.product?.id ?? '');
    if (fx) g.cost += egpMinor(Number(r.payload.qty ?? 0) * fx.cost, fx.currency);
    g.risk += r.impact;
    if (r.priority === 1) g.urgent++;
    const ob = r.payload.orderBy as string | undefined;
    if (ob && (!g.orderBy || ob < g.orderBy)) g.orderBy = ob;
    groups.set(k, g);
  }
  const list = [...groups.values()].sort((a, b) => b.urgent - a.urgent || (a.orderBy ?? '').localeCompare(b.orderBy ?? '') || b.risk - a.risk);
  return {
    groups: list.map((g) => ({ ...g, cost: s.cost ? g.cost : null, risk: s.money ? g.risk : null })),
    expedites: recs.filter((r) => r.kind === 'expedite'),
    totals: { lines: list.reduce((a, g) => a + g.lines.length, 0), units: list.reduce((a, g) => a + g.units, 0), cost: s.cost ? list.reduce((a, g) => a + g.cost, 0) : null, risk: s.money ? list.reduce((a, g) => a + g.risk, 0) : null },
    canAct: s.act('procurement'),
  };
}

export async function poList(p: Principal, f: { status?: string; supplier?: string; q?: string }) {
  const db = await getDb();
  const s = sees(p);
  const markets = marketsFor(p);
  const rows = await db
    .select({ po: schema.purchaseOrders, supplier: schema.suppliers.name, location: schema.locations.name })
    .from(schema.purchaseOrders)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.purchaseOrders.supplierId))
    .leftJoin(schema.locations, eq(schema.locations.id, schema.purchaseOrders.locationId))
    .where(and(inArray(schema.purchaseOrders.market, markets), p.brands?.length ? poOfBrands(p.brands, sql`${schema.purchaseOrders.id}`, sql`${schema.purchaseOrders.supplierId}`) : undefined))
    .orderBy(desc(schema.purchaseOrders.createdAt));
  const rec = await db.execute<{ po_id: string; got: number; qty: number }>(sql`select po_id, sum(received + damaged)::int as got, sum(qty)::int as qty from po_lines group by 1`);
  const now = Date.now();
  const all = rows.map(({ po, supplier, location }) => {
    const r = rec.rows.find((x) => x.po_id === po.id);
    const open = PO_STATUS[po.status as PoStatus]?.open ?? false;
    const late = open && ['sent', 'confirmed', 'partial'].includes(po.status) && po.expectedAt != null && po.expectedAt.getTime() < now;
    return {
      id: po.id,
      number: po.number,
      supplier: supplier ?? '—',
      supplierId: po.supplierId,
      location: location ?? po.locationId,
      market: po.market,
      company: po.company,
      status: po.status as PoStatus,
      open,
      late,
      units: po.units,
      total: s.cost ? egpMinor(po.total, po.currency) : null,
      totalLocal: s.cost ? money(po.total, po.currency, { compact: true }) : null,
      received: r?.qty ? r.got / r.qty : 0,
      expectedAt: po.expectedAt?.toISOString() ?? null,
      createdAt: po.createdAt.toISOString(),
      createdByName: po.createdByName,
      source: po.source,
      season: po.season,
    };
  });
  const q = f.q?.trim().toLowerCase();
  const filtered = all.filter(
    (x) =>
      (!f.status ? x.open : f.status === 'all' ? true : f.status === 'late' ? x.late : x.status === f.status) &&
      (!f.supplier || x.supplierId === f.supplier) &&
      (!q || x.number.toLowerCase().includes(q) || x.supplier.toLowerCase().includes(q)),
  );
  const openOnes = all.filter((x) => x.open);
  const week = now + 7 * 86_400_000;
  return {
    rows: filtered.slice(0, 200),
    counts: {
      open: openOnes.length,
      approval: all.filter((x) => x.status === 'approval').length,
      late: all.filter((x) => x.late).length,
      draft: all.filter((x) => x.status === 'draft').length,
      all: all.length,
    },
    kpi: {
      openValue: s.cost ? openOnes.reduce((a, x) => a + (x.total ?? 0), 0) : null,
      openUnits: openOnes.reduce((a, x) => a + x.units, 0),
      arrivingWeek: openOnes.filter((x) => ['sent', 'confirmed', 'partial'].includes(x.status) && x.expectedAt && Date.parse(x.expectedAt) < week).reduce((a, x) => a + x.units * (1 - x.received), 0),
      approvalValue: s.cost ? all.filter((x) => x.status === 'approval').reduce((a, x) => a + (x.total ?? 0), 0) : null,
    },
    suppliers: [...new Map(all.map((x) => [x.supplierId, x.supplier])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    seesCost: s.cost,
  };
}

/** How each supplier has really performed: on time, complete, undamaged, and how long it takes. */
export async function supplierScores(p: Principal) {
  const db = await getDb();
  const s = sees(p);
  const markets = marketsFor(p);
  const rows = await db.execute<{
    id: string; name: string; country: string; currency: string; brands: string[]; lead_days: number; moq: number; case_pack: number; payment_terms: string | null;
    pos: number; on_time: number; delay: number | null; lead_actual: number | null; qty: number; got: number; damaged: number; spend: number; open_pos: number; open_units: number;
  }>(sql`
    with po as (
      select po.*, (select sum(qty)::int from po_lines where po_id = po.id) as qty, (select sum(received)::int from po_lines where po_id = po.id) as got, (select sum(damaged)::int from po_lines where po_id = po.id) as damaged
      from purchase_orders po where ${inMarkets(markets, sql`po.market`, { who: p, po: 'po' })}
    )
    select s.id, s.name, s.country, s.currency, s.brands, s.lead_days, s.moq, s.case_pack, s.payment_terms,
      count(po.id) filter (where po.received_at > now() - interval '365 days')::int as pos,
      count(po.id) filter (where po.received_at > now() - interval '365 days' and po.received_at <= po.expected_at + interval '2 days')::int as on_time,
      avg(extract(epoch from po.received_at - po.expected_at) / 86400) filter (where po.received_at > now() - interval '365 days')::float8 as delay,
      avg(extract(epoch from po.received_at - po.sent_at) / 86400) filter (where po.received_at > now() - interval '365 days' and po.sent_at is not null)::float8 as lead_actual,
      coalesce(sum(po.qty) filter (where po.received_at > now() - interval '365 days'), 0)::int as qty,
      coalesce(sum(po.got) filter (where po.received_at > now() - interval '365 days'), 0)::int as got,
      coalesce(sum(po.damaged) filter (where po.received_at > now() - interval '365 days'), 0)::int as damaged,
      coalesce(sum(po.total) filter (where po.received_at > now() - interval '365 days' and po.market = 'EG'), 0)::bigint
        + coalesce(sum(po.total * 158 / 10) filter (where po.received_at > now() - interval '365 days' and po.market = 'KW'), 0)::bigint as spend,
      count(po.id) filter (where po.status in ('approved','sent','confirmed','partial'))::int as open_pos,
      coalesce(sum(po.units) filter (where po.status in ('approved','sent','confirmed','partial')), 0)::int as open_units
    from suppliers s left join po on po.supplier_id = s.id
    group by s.id order by s.name`);
  return {
    rows: rows.rows.map((r) => ({
      ...r,
      onTime: r.pos ? r.on_time / r.pos : null,
      fill: r.qty ? r.got / r.qty : null,
      damage: r.got ? r.damaged / (r.got + r.damaged) : null,
      spend: s.cost ? Number(r.spend) : null,
      grade: !r.pos ? '—' : r.on_time / r.pos >= 0.85 && (r.qty ? r.got / r.qty : 1) >= 0.95 ? 'A' : r.on_time / r.pos >= 0.6 ? 'B' : 'C',
    })),
    canManage: s.manage('procurement'),
  };
}

export async function poDetail(p: Principal, id: string) {
  const db = await getDb();
  const s = sees(p);
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
  if (!po || !marketsFor(p).includes(po.market as 'EG' | 'KW')) return null;
  if (p.brands?.length && !(await db.execute(sql`select 1 from purchase_orders po where po.id = ${id} and ${poOfBrands(p.brands, sql`po.id`, sql`po.supplier_id`)}`)).rows.length) return null;
  const [[supplier], [location], lines, acts, tasks, rules] = await Promise.all([
    db.select().from(schema.suppliers).where(eq(schema.suppliers.id, po.supplierId)),
    db.select().from(schema.locations).where(eq(schema.locations.id, po.locationId)),
    db
      .select({ l: schema.poLines, v: schema.variants, p: schema.products })
      .from(schema.poLines)
      .innerJoin(schema.variants, eq(schema.variants.id, schema.poLines.variantId))
      .innerJoin(schema.products, eq(schema.products.id, schema.poLines.productId))
      .where(eq(schema.poLines.poId, id))
      .orderBy(asc(schema.products.title), asc(schema.variants.sizeIdx)),
    db.select().from(schema.activity).where(and(eq(schema.activity.refType, 'po'), eq(schema.activity.refId, id))).orderBy(desc(schema.activity.at)).limit(30),
    db.select({ t: schema.tasks, who: schema.users.name }).from(schema.tasks).leftJoin(schema.users, eq(schema.users.id, schema.tasks.assigneeId)).where(eq(schema.tasks.refId, id)).orderBy(desc(schema.tasks.createdAt)),
    stockRules(),
  ]);
  const facts = await getFacts();
  // one row per style, its sizes alongside
  const styles = new Map<string, { productId: string; title: string; brand: string; image: string | null; cover: number | null; sizes: { lineId: string; size: string; qty: number; received: number; damaged: number }[]; qty: number; received: number; damaged: number; cost: number }>();
  for (const { l, v, p: prod } of lines) {
    const cur = styles.get(prod.id) ?? { productId: prod.id, title: prod.title, brand: prod.brand, image: prod.image, cover: facts.byId.get(prod.id)?.cover ?? null, sizes: [], qty: 0, received: 0, damaged: 0, cost: 0 };
    cur.sizes.push({ lineId: l.id, size: v.size ?? 'One size', qty: l.qty, received: l.received, damaged: l.damaged });
    cur.qty += l.qty;
    cur.received += l.received;
    cur.damaged += l.damaged;
    cur.cost += l.qty * l.unitCost;
    styles.set(prod.id, cur);
  }
  const lvl = level(p, 'procurement');
  const totalEgp = egpMinor(po.total, po.currency);
  const overLimit = totalEgp > rules.approvalLimit;
  // one approve button: under the limit approving is the buyer's own call; over it, they send it on and an approver signs
  const steps = (PO_FLOW[po.status as PoStatus] ?? []).filter((x) => (lvl >= x.min || (x.to === 'approval' && lvl >= 2)) && !(po.status === 'draft' && x.to === 'approved' && !overLimit));
  return {
    po: {
      ...po,
      statusLabel: PO_STATUS[po.status as PoStatus]?.label ?? po.status,
      tint: PO_STATUS[po.status as PoStatus]?.tint ?? 'neutral',
      total: s.cost ? money(po.total, po.currency) : null,
      totalEgp: s.cost ? totalEgp : null,
      late: ['sent', 'confirmed', 'partial'].includes(po.status) && po.expectedAt != null && po.expectedAt.getTime() < Date.now(),
    },
    track: PO_TRACK,
    supplier,
    location,
    styles: [...styles.values()].map((x) => ({ ...x, cost: s.cost ? money(x.cost, po.currency) : null })),
    activity: acts,
    tasks: tasks.map(({ t, who }) => ({ ...t, who })),
    steps: steps.map((x) => ({ to: x.to, label: x.to === 'approval' ? (overLimit ? 'Send for approval' : 'Approve') : x.label })),
    empty: lines.length === 0,
    overLimit,
    limit: moneyIn(rules.approvalLimit, viewCurrency(p), { compact: true }),
    canEdit: po.status === 'draft' && lvl >= 2,
    canReceive: ['sent', 'confirmed', 'partial'].includes(po.status) && (s.act('warehouse') || lvl >= 2),
    fmt: { expected: po.expectedAt ? fmtDay(po.expectedAt) : null },
  };
}

export type PoDetail = NonNullable<Awaited<ReturnType<typeof poDetail>>>;

export type PoCandidate = { productId: string; title: string; brand: string; image: string | null; styleCode: string; sizes: string; rate: number; cover: number | null; suggest: number };

/**
 * Styles that can go on a draft purchase order: with a search, any style in its market by name,
 * style code, SKU or barcode; without one, this supplier's brands, what sells fastest first, each
 * with a suggested quantity (about eight weeks of sales, in sixes).
 */
export async function poCandidates(p: Principal, poId: string, q: string): Promise<PoCandidate[]> {
  const db = await getDb();
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, poId));
  if (!po || !marketsFor(p).includes(po.market as 'EG' | 'KW')) return [];
  const [sup] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, po.supplierId));
  const brands = (sup?.brands ?? []).map((b) => b.toLowerCase());
  const term = q.trim().slice(0, 64);
  const match = term
    ? sql`(p.title ilike ${`%${term}%`} or p.style_code ilike ${`${term}%`} or p.brand ilike ${`${term}%`} or exists (select 1 from variants v where v.product_id = p.id and (v.sku ilike ${`${term}%`} or v.barcode = ${term})))`
    : brands.length
      ? sql`lower(p.brand) in (${sql.join(brands.map((b) => sql`${b}`), sql`, `)})`
      : sql`true`;
  const rows = await db.execute<{ id: string; title: string; brand: string; image: string | null; style_code: string; sizes: string | null }>(sql`
    select p.id, p.title, p.brand, p.image, p.style_code,
      (select string_agg(coalesce(v.size, 'One size'), ' · ' order by v.size_idx) from variants v where v.product_id = p.id) as sizes
    from products p
    where p.market = ${po.market} and p.status = 'active' and ${match}
    limit 400`);
  const facts = await getFacts();
  return rows.rows
    .map((r) => {
      const f = facts.byId.get(r.id);
      const rate = f?.rate ?? 0;
      return { productId: r.id, title: r.title, brand: r.brand, image: r.image, styleCode: r.style_code, sizes: r.sizes ?? '', rate, cover: f && Number.isFinite(f.cover) ? f.cover : null, suggest: Math.max(6, Math.ceil((rate * 8) / 6) * 6) };
    })
    .sort((a, b) => b.rate - a.rate || a.title.localeCompare(b.title))
    .slice(0, term ? 20 : 12);
}
