import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { RelayError } from './errors';
import { can, seesBrand, seesCost, type Principal } from './domain/perms';
import {
  aqlPlan,
  aqlVerdict,
  costPerPiece,
  COST_PARTS,
  currentStep,
  daysLate,
  isFinished,
  lateSteps,
  marginOn,
  nextProductionNumber,
  planSteps,
  progress,
  PRODUCTION_STEPS,
  STEP,
  totalQty,
  type Costs,
  type Inspection,
  type Payment,
  type Step,
  type StepKey,
} from './domain/production';
import { egpMinor, logActivity } from './stock/core';
import { toMajor } from './format';
import { marketsFor } from './stock/views/common';

const today = () => new Date().toISOString().slice(0, 10);
const who = (p: Principal) => ({ id: p.id, name: p.name });
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

type Row = typeof schema.productionOrders.$inferSelect;

/** An order as the screens show it: where it stands, how late, what it costs (to those who see cost). */
function view(p: Principal, r: Row, makerName: string | null) {
  const t = today();
  const cost = costPerPiece(r.costs);
  const sc = seesCost(p);
  const late = lateSteps(r.steps, t);
  const paid = r.payments.filter((x) => x.paidAt).reduce((a, x) => a + x.amount, 0);
  const lastQc = [...r.inspections].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  return {
    id: r.id,
    number: r.number,
    makerId: r.makerId,
    maker: makerName ?? '—',
    brand: r.brand,
    market: r.market,
    season: r.season,
    styleCode: r.styleCode,
    title: r.title,
    category: r.category,
    colour: r.colour,
    image: r.image,
    sizes: r.sizes,
    qty: r.qty,
    currency: r.currency,
    status: r.status,
    stage: r.stage as StepKey,
    stageLabel: STEP[r.stage as StepKey]?.short ?? r.stage,
    dueAt: r.dueAt,
    progress: progress(r.steps),
    late: r.status === 'open' ? late.length : 0,
    daysLate: r.status === 'open' ? daysLate(r.steps, t) : 0,
    nextPlanned: r.steps.find((s) => s.key === r.stage)?.planned ?? null,
    received: r.received,
    rejected: r.rejected,
    lastQc: lastQc ? { at: lastQc.at, result: lastQc.result, kind: lastQc.kind } : null,
    // money only for those who see cost prices
    costPerPiece: sc ? cost : null,
    value: sc ? cost * r.qty : null,
    valueEgp: sc ? egpMinor(cost * r.qty, r.currency) : null,
    retailPrice: r.retailPrice,
    margin: sc ? marginOn(cost, r.retailPrice) : null,
    paid: sc ? paid : null,
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type ProductionView = ReturnType<typeof view>;

async function readable(p: Principal, id: string) {
  const db = await getDb();
  const [r] = await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, id));
  if (!r || !marketsFor(p).includes(r.market as 'EG' | 'KW') || !seesBrand(p, r.brand)) return null;
  return r;
}

export async function productionList(p: Principal, f: { status?: string; brand?: string; maker?: string; q?: string } = {}) {
  const db = await getDb();
  const markets = marketsFor(p);
  const [rows, makers] = await Promise.all([
    db
      .select({ r: schema.productionOrders, maker: schema.makers.name })
      .from(schema.productionOrders)
      .leftJoin(schema.makers, eq(schema.makers.id, schema.productionOrders.makerId))
      .where(sql`${schema.productionOrders.market} in (${sql.join(markets.map((m) => sql`${m}`), sql`, `)})`)
      .orderBy(asc(schema.productionOrders.dueAt), desc(schema.productionOrders.createdAt)),
    db.select().from(schema.makers).orderBy(asc(schema.makers.name)),
  ]);
  const mine = rows.filter(({ r }) => seesBrand(p, r.brand));
  const all = mine.map(({ r, maker }) => view(p, r, maker));
  const q = f.q?.trim().toLowerCase();
  const list = all.filter(
    (x) =>
      (!f.status || f.status === 'all' ? x.status !== 'cancelled' || f.status === 'all' : f.status === 'late' ? x.status === 'open' && x.late > 0 : x.status === f.status) &&
      (!f.brand || x.brand === f.brand) &&
      (!f.maker || x.makerId === f.maker) &&
      (!q || `${x.number} ${x.styleCode} ${x.title} ${x.maker} ${x.brand}`.toLowerCase().includes(q)),
  );
  const open = all.filter((x) => x.status === 'open');
  const t = today();
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const inspections = mine.flatMap(({ r }) => r.inspections.filter((i) => i.kind === 'final'));
  const byStage = PRODUCTION_STEPS.map((s) => ({ key: s.key, label: s.short, n: open.filter((x) => x.stage === s.key).length, units: open.filter((x) => x.stage === s.key).reduce((a, x) => a + x.qty, 0) }));
  return {
    rows: list,
    makers: makers.map((m) => ({ id: m.id, name: m.name, active: m.active, open: open.filter((x) => x.makerId === m.id).length })),
    brands: [...new Set(all.map((x) => x.brand))].sort(),
    byStage,
    kpi: {
      open: open.length,
      units: open.reduce((a, x) => a + x.qty, 0),
      valueEgp: seesCost(p) ? open.reduce((a, x) => a + (x.valueEgp ?? 0), 0) : null,
      late: open.filter((x) => x.late > 0).length,
      dueSoon: open.filter((x) => x.dueAt && x.dueAt >= t && x.dueAt <= in30).length,
      qcPassRate: inspections.length ? inspections.filter((i) => i.result === 'pass').length / inspections.length : null,
    },
    canCreate: can(p, 'production', 3),
    seesCost: seesCost(p),
  };
}

export async function productionDetail(p: Principal, id: string) {
  const r = await readable(p, id);
  if (!r) return null;
  const db = await getDb();
  const [[maker], log] = await Promise.all([
    db.select().from(schema.makers).where(eq(schema.makers.id, r.makerId)),
    db.select().from(schema.activity).where(and(eq(schema.activity.refType, 'production'), eq(schema.activity.refId, id))).orderBy(desc(schema.activity.at)).limit(60),
  ]);
  const sc = seesCost(p);
  return {
    order: view(p, r, maker?.name ?? null),
    maker: maker ? { id: maker.id, name: maker.name, city: maker.city, country: maker.country, contact: maker.contactName, phone: maker.phone, email: maker.email, terms: maker.paymentTerms, leadDays: maker.leadDays } : null,
    steps: PRODUCTION_STEPS.map((s) => ({ ...s, ...(r.steps.find((x) => x.key === s.key) ?? { planned: null, done: null }) })),
    costs: sc ? COST_PARTS.map((c) => ({ ...c, value: r.costs[c.key] ?? 0 })) : null,
    inspections: [...r.inspections].sort((a, b) => b.at.localeCompare(a.at)),
    payments: sc ? r.payments : null,
    note: r.note,
    aql: aqlPlan(r.qty),
    log: log.map((a) => ({ id: a.id, at: a.at.toISOString(), who: a.actorName, message: a.message })),
    canStep: can(p, 'production', 2),
    canManage: can(p, 'production', 3),
    canPay: can(p, 'production', 3) || can(p, 'money', 3),
  };
}
export type ProductionDetail = NonNullable<Awaited<ReturnType<typeof productionDetail>>>;

// ── Changes ───────────────────────────────────────────────────────────────────────────────────

export type NewProduction = {
  makerId: string;
  brand: string;
  market: 'EG' | 'KW';
  season?: string;
  styleCode: string;
  title: string;
  category?: string;
  colour?: string;
  image?: string;
  sizes: Record<string, number>;
  currency: string;
  costs?: Costs;
  retailPrice?: number | null;
  start?: string;
  dueAt?: string | null;
  note?: string;
};

export async function createProduction(p: Principal, i: NewProduction) {
  if (!can(p, 'production', 3)) throw new RelayError('forbidden', 'Placing production orders needs Production manage access.');
  if (!marketsFor(p).includes(i.market)) throw new RelayError('forbidden', 'That market is outside your stores.');
  if (!seesBrand(p, i.brand)) throw new RelayError('forbidden', 'That brand is outside the brands you cover.');
  const db = await getDb();
  const [maker] = await db.select().from(schema.makers).where(eq(schema.makers.id, i.makerId));
  if (!maker) throw new RelayError('invalid', 'Choose the factory.');
  if (!i.styleCode.trim() || !i.title.trim()) throw new RelayError('invalid', 'Add the style code and a name.');
  const sizes = Object.fromEntries(Object.entries(i.sizes).map(([k, v]) => [k.trim(), Math.max(0, Math.trunc(Number(v) || 0))]).filter(([k, v]) => k && (v as number) > 0));
  const qty = totalQty(sizes);
  if (!qty) throw new RelayError('invalid', 'Add the quantity per size.');
  const start = isDay(i.start) ? i.start : today();
  const due = isDay(i.dueAt) ? i.dueAt : null;
  const steps = planSteps(start, due);
  // the brief goes out the day it is placed
  steps[0] = { ...steps[0], done: start, by: p.name };
  const [last] = await db.select({ n: schema.productionOrders.number }).from(schema.productionOrders).orderBy(desc(schema.productionOrders.number)).limit(1);
  const costs = cleanCosts(i.costs ?? {});
  const [row] = await db
    .insert(schema.productionOrders)
    .values({
      number: nextProductionNumber(last?.n),
      makerId: maker.id,
      brand: i.brand.trim(),
      market: i.market,
      season: i.season?.trim() || null,
      styleCode: i.styleCode.trim(),
      title: i.title.trim(),
      category: i.category?.trim() || null,
      colour: i.colour?.trim() || null,
      image: i.image?.trim() || null,
      sizes,
      qty,
      currency: i.currency,
      costs,
      retailPrice: i.retailPrice ?? null,
      steps,
      stage: currentStep(steps),
      dueAt: due ?? steps.find((s) => s.key === 'shipped')?.planned ?? null,
      note: i.note?.trim() || null,
      createdBy: p.id,
      createdByName: p.name,
    })
    .returning();
  await logActivity(who(p), { area: 'production', kind: 'production_created', refType: 'production', refId: row.id, message: `Placed ${row.number}: ${qty.toLocaleString('en')} × ${row.title} with ${maker.name}` });
  return row;
}

const cleanCosts = (c: Costs): Costs => Object.fromEntries(COST_PARTS.map((x) => [x.key, Math.max(0, Math.round(Number(c[x.key]) || 0))]).filter(([, v]) => (v as number) > 0));

async function save(p: Principal, r: Row, patch: Partial<typeof schema.productionOrders.$inferInsert>, message: string, kind: string) {
  const db = await getDb();
  const steps = (patch.steps ?? r.steps) as Step[];
  const finished = isFinished(steps);
  await db
    .update(schema.productionOrders)
    .set({ ...patch, stage: currentStep(steps), ...(r.status !== 'cancelled' ? { status: finished ? 'done' : 'open' } : {}), updatedAt: new Date() })
    .where(eq(schema.productionOrders.id, r.id));
  await logActivity(who(p), { area: 'production', kind, refType: 'production', refId: r.id, message: `${r.number}: ${message}` });
}

async function writable(p: Principal, id: string, min: 2 | 3) {
  if (!can(p, 'production', min)) throw new RelayError('forbidden', min === 3 ? 'Needs Production manage access.' : 'Needs Production access to update steps.');
  const r = await readable(p, id);
  if (!r) throw new RelayError('not_found', 'No such production order.');
  if (r.status === 'cancelled' && min === 2) throw new RelayError('invalid', 'This order was cancelled.');
  return r;
}

/** Marks a step done (or not), moves its planned date, or notes something on it. */
export async function updateStep(p: Principal, id: string, key: StepKey, change: { done?: string | null; planned?: string | null; note?: string | null }) {
  const r = await writable(p, id, 2);
  if (!STEP[key]) throw new RelayError('invalid', 'No such step.');
  const steps = PRODUCTION_STEPS.map((s) => r.steps.find((x) => x.key === s.key) ?? { key: s.key, planned: null, done: null });
  const i = steps.findIndex((s) => s.key === key);
  const cur = steps[i];
  const next: Step = { ...cur };
  const parts: string[] = [];
  if (change.done !== undefined) {
    if (change.done && !isDay(change.done)) throw new RelayError('invalid', 'Pick the day it was done.');
    if (key === 'qc' && change.done && !r.inspections.some((x) => x.kind === 'final' && x.result === 'pass')) throw new RelayError('invalid', 'Record a final inspection that passed first.');
    next.done = change.done;
    next.by = change.done ? p.name : null;
    parts.push(change.done ? `${STEP[key].label}` : `${STEP[key].short} reopened`);
  }
  if (change.planned !== undefined) {
    if (change.planned && !isDay(change.planned)) throw new RelayError('invalid', 'Pick a planned day.');
    next.planned = change.planned;
    parts.push(`${STEP[key].short} planned for ${change.planned ?? 'no date'}`);
  }
  if (change.note !== undefined) {
    next.note = change.note?.trim().slice(0, 300) || null;
    if (next.note) parts.push(`${STEP[key].short}: ${next.note}`);
  }
  steps[i] = next;
  const patch: Partial<typeof schema.productionOrders.$inferInsert> = { steps };
  if (key === 'shipped' && change.planned !== undefined) patch.dueAt = change.planned;
  await save(p, r, patch, parts.join(' · ') || 'step updated', 'production_step');
}

/** An inspection at the factory: the pieces pulled, the defects found, the verdict (AQL 2.5 by default). */
export async function addInspection(p: Principal, id: string, i: { kind: 'inline' | 'final'; lot?: number; sampled?: number; major: number; minor: number; result?: 'pass' | 'fail' | 'rework'; note?: string; at?: string }) {
  const r = await writable(p, id, 2);
  const lot = Math.max(1, Math.trunc(i.lot ?? r.qty));
  const plan = aqlPlan(lot);
  const major = Math.max(0, Math.trunc(i.major || 0));
  const minor = Math.max(0, Math.trunc(i.minor || 0));
  const result = i.result ?? aqlVerdict(lot, major, minor);
  const ins: Inspection = { id: randomUUID(), at: isDay(i.at) ? i.at : today(), kind: i.kind, lot, sampled: Math.max(1, Math.trunc(i.sampled ?? plan.sample)), major, minor, result, inspector: p.name, note: i.note?.trim().slice(0, 400) || undefined };
  const patch: Partial<typeof schema.productionOrders.$inferInsert> = { inspections: [...r.inspections, ins] };
  // a passed final inspection ticks the QC step
  if (i.kind === 'final' && result === 'pass') patch.steps = r.steps.map((s) => (s.key === 'qc' && !s.done ? { ...s, done: ins.at, by: p.name } : s));
  await save(p, r, patch, `${i.kind === 'final' ? 'Final' : 'Inline'} inspection ${result}: ${major} major, ${minor} minor in ${ins.sampled} pieces`, 'production_qc');
}

/** Money owed to the factory: a deposit, the balance, or anything else; and the day it was paid. */
export async function addPayment(p: Principal, id: string, i: { kind: Payment['kind']; amount: number; due?: string | null; ref?: string; note?: string }) {
  if (!seesCost(p)) throw new RelayError('forbidden', 'Needs access to cost prices.');
  const r = await writable(p, id, 3);
  const amount = Math.max(0, Math.round(i.amount || 0));
  if (!amount) throw new RelayError('invalid', 'Enter the amount.');
  const pay: Payment = { id: randomUUID(), kind: i.kind, amount, due: isDay(i.due) ? i.due : null, paidAt: null, ref: i.ref?.trim() || null, note: i.note?.trim() || null };
  await save(p, r, { payments: [...r.payments, pay] }, `${i.kind === 'deposit' ? 'Deposit' : i.kind === 'balance' ? 'Balance' : 'Payment'} of ${toMajor(amount, r.currency).toLocaleString('en')} ${r.currency} due ${pay.due ?? 'on agreement'}`, 'production_payment');
}

export async function markPaid(p: Principal, id: string, paymentId: string, paidAt: string | null, ref?: string) {
  if (!can(p, 'production', 3) && !can(p, 'money', 3)) throw new RelayError('forbidden', 'Needs Production manage or refund-level money access.');
  const r = await readable(p, id);
  if (!r) throw new RelayError('not_found', 'No such production order.');
  const pay = r.payments.find((x) => x.id === paymentId);
  if (!pay) throw new RelayError('not_found', 'No such payment.');
  const payments = r.payments.map((x) => (x.id === paymentId ? { ...x, paidAt: isDay(paidAt) ? paidAt : null, ref: ref?.trim() || x.ref } : x));
  await save(p, r, { payments }, paidAt ? `Paid the ${pay.kind}${ref ? ` (${ref})` : ''}` : `The ${pay.kind} marked unpaid`, 'production_payment');
}

/** Quantities, costs, the retail price, dates, the photo or note; or cancelling it. */
export async function updateProduction(p: Principal, id: string, i: { sizes?: Record<string, number>; costs?: Costs; retailPrice?: number | null; dueAt?: string | null; note?: string | null; image?: string | null; colour?: string | null; received?: number; rejected?: number; cancel?: boolean; reopen?: boolean }) {
  const r = await writable(p, id, i.received !== undefined || i.rejected !== undefined ? 2 : 3);
  const patch: Partial<typeof schema.productionOrders.$inferInsert> = {};
  const parts: string[] = [];
  if (i.sizes) {
    const sizes = Object.fromEntries(Object.entries(i.sizes).map(([k, v]) => [k.trim(), Math.max(0, Math.trunc(Number(v) || 0))]).filter(([k, v]) => k && (v as number) > 0));
    patch.sizes = sizes;
    patch.qty = totalQty(sizes);
    parts.push(`quantity ${patch.qty.toLocaleString('en')}`);
  }
  if (i.costs) {
    if (!seesCost(p)) throw new RelayError('forbidden', 'Needs access to cost prices.');
    patch.costs = cleanCosts(i.costs);
    parts.push(`cost ${toMajor(costPerPiece(patch.costs), r.currency).toLocaleString('en')} ${r.currency} a piece`);
  }
  if (i.retailPrice !== undefined) {
    patch.retailPrice = i.retailPrice;
    parts.push('retail price set');
  }
  if (i.dueAt !== undefined) {
    patch.dueAt = isDay(i.dueAt) ? i.dueAt : null;
    parts.push(`ex-factory ${patch.dueAt ?? 'open'}`);
  }
  if (i.note !== undefined) patch.note = i.note?.trim() || null;
  if (i.image !== undefined) patch.image = i.image?.trim() || null;
  if (i.colour !== undefined) patch.colour = i.colour?.trim() || null;
  if (i.received !== undefined) {
    patch.received = Math.max(0, Math.trunc(i.received));
    parts.push(`${patch.received} received`);
  }
  if (i.rejected !== undefined) {
    patch.rejected = Math.max(0, Math.trunc(i.rejected));
    parts.push(`${patch.rejected} rejected`);
  }
  if (i.cancel) {
    patch.status = 'cancelled';
    parts.push('cancelled');
  }
  if (i.reopen && r.status === 'cancelled') {
    patch.status = 'open';
    parts.push('reopened');
  }
  const db = await getDb();
  if (i.cancel || i.reopen) {
    await db.update(schema.productionOrders).set({ ...patch, updatedAt: new Date() }).where(eq(schema.productionOrders.id, r.id));
    await logActivity(who(p), { area: 'production', kind: 'production_status', refType: 'production', refId: r.id, message: `${r.number}: ${parts.join(' · ')}` });
    return;
  }
  await save(p, r, patch, parts.join(' · ') || 'details updated', 'production_update');
}

export type MakerInput = { id?: string; name: string; country?: string; city?: string; contactName?: string; phone?: string; email?: string; skills?: string[]; capacity?: number | null; leadDays?: number | null; paymentTerms?: string; notes?: string; active?: boolean };

export async function saveMaker(p: Principal, i: MakerInput) {
  if (!can(p, 'production', 3)) throw new RelayError('forbidden', 'Managing factories needs Production manage access.');
  if (!i.name.trim()) throw new RelayError('invalid', 'Add the factory’s name.');
  const db = await getDb();
  const values = {
    name: i.name.trim(),
    country: i.country?.trim() || 'EG',
    city: i.city?.trim() || null,
    contactName: i.contactName?.trim() || null,
    phone: i.phone?.trim() || null,
    email: i.email?.trim() || null,
    skills: (i.skills ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 12),
    capacity: i.capacity ? Math.max(0, Math.trunc(i.capacity)) : null,
    leadDays: i.leadDays ? Math.max(0, Math.trunc(i.leadDays)) : null,
    paymentTerms: i.paymentTerms?.trim() || null,
    notes: i.notes?.trim() || null,
    active: i.active ?? true,
  };
  if (i.id) {
    await db.update(schema.makers).set(values).where(eq(schema.makers.id, i.id));
    await logActivity(who(p), { area: 'production', kind: 'maker_saved', refType: 'maker', refId: i.id, message: `Updated the factory ${values.name}` });
    return i.id;
  }
  const [m] = await db.insert(schema.makers).values(values).returning({ id: schema.makers.id });
  await logActivity(who(p), { area: 'production', kind: 'maker_saved', refType: 'maker', refId: m.id, message: `Added the factory ${values.name}` });
  return m.id;
}

export async function makersFor(p: Principal) {
  const db = await getDb();
  const [makers, orders] = await Promise.all([db.select().from(schema.makers).orderBy(asc(schema.makers.name)), db.select().from(schema.productionOrders)]);
  const t = today();
  const mine = orders.filter((o) => seesBrand(p, o.brand) && marketsFor(p).includes(o.market as 'EG' | 'KW'));
  return makers.map((m) => {
    const os = mine.filter((o) => o.makerId === m.id);
    const open = os.filter((o) => o.status === 'open');
    const finals = os.flatMap((o) => o.inspections.filter((i) => i.kind === 'final'));
    const done = os.filter((o) => o.status === 'done');
    // on time: shipped on or before the day it was planned
    const onTime = done.filter((o) => {
      const s = o.steps.find((x) => x.key === 'shipped');
      return s?.done && s.planned && s.done <= s.planned;
    }).length;
    return {
      ...m,
      open: open.length,
      units: open.reduce((a, o) => a + o.qty, 0),
      late: open.filter((o) => lateSteps(o.steps, t).length > 0).length,
      done: done.length,
      onTime: done.length ? onTime / done.length : null,
      qcPass: finals.length ? finals.filter((i) => i.result === 'pass').length / finals.length : null,
    };
  });
}
