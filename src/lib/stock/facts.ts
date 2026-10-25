import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { addWeeks, eventLift, keyToTime, weekOf, weekRange, type Market } from '../domain/stock/calendar';
import { CATEGORIES, indexOn, learnIndex, priorIndex, type Category } from '../domain/stock/categories';
import { baseRate, forecastWeeks, project, sellThrough, stockoutWeek, trendFactor, weeksOfCover, type WeekObs } from '../domain/stock/forecast';
import { abc, median, velocity, xyz, type Abc, type Velocity, type Xyz } from '../domain/stock/classify';
import { egpMinor } from './core';
import { seesBrand } from '../domain/perms';

// One reading of the whole range, shared by the planner and every stock screen, so what a page
// shows and what the AI proposes are the same numbers. On a large range a full reading holds the
// one database (PGlite) for half a minute, and every page waits behind it, so readings are rare: a
// page always gets the last one, a fresh one starts behind it only when that is older than FRESH_MS
// (RELAY_STOCK_REFRESH_MINUTES, default 6 hours), and the planner asks for a fresh one and waits.
// A change made on a stock screen marks the reading old without starting one on the spot.

export const HORIZON = 26; // weeks forecast ahead
const HISTORY = 26; // completed weeks read per style

export type ProductFacts = {
  id: string;
  market: Market;
  company: string;
  styleCode: string;
  title: string;
  brand: string;
  category: Category;
  season: string;
  image: string | null;
  currency: string;
  price: number;
  cost: number;
  compareAt: number | null;
  margin: number;
  sizes: string[];
  sizeMix: Record<string, number>;
  supplierId: string | null;
  supplierName: string | null;
  leadDays: number;
  moq: number;
  casePack: number;
  channels: string[];
  status: string;
  launchedAt: Date;
  // stock
  onHand: number;
  byLocation: Record<string, { onHand: number; rate: number }>;
  warehouseOnHand: number;
  onOrder: number;
  inDraft: number;
  arrivals: Record<string, number>;
  inTransit: number;
  // demand
  weekly: WeekObs[];
  onlineShare: number;
  sold4: number;
  sold8: number;
  sold13: number;
  revenue13: number; // own currency, minor
  base: number;
  trend: number;
  sigma: number;
  rate: number; // expected units this coming week
  forecast: number[]; // HORIZON weeks from this week
  cover: number; // weeks
  stockout: string | null; // week the shelf empties, arrivals included
  sellThrough8: number;
  weeksLive: number;
  weeksSinceSale: number | null;
  abc: Abc;
  xyz: Xyz;
  velocity: Velocity;
  valueCostEgp: number; // stock at cost, EGP-equivalent minor
  valueRetailEgp: number;
};

export type Facts = {
  at: number;
  week: string; // this week
  firstWeekLeft: number; // share of this week still to come
  weeks: string[]; // HORIZON weeks from this week
  history: string[]; // HISTORY completed weeks
  products: ProductFacts[];
  byId: Map<string, ProductFacts>;
  index: Record<Market, Record<Category, number[]>>; // learned monthly curves, events taken out
  si: (market: Market, category: Category, week: string, onlineShare: number) => number;
};

const FRESH_MS = Math.max(10, Number(process.env.RELAY_STOCK_REFRESH_MINUTES ?? 360)) * 60_000;
const g = globalThis as unknown as { __stockFacts?: { at: number; facts: Facts; dirty?: boolean }; __stockFactsNext?: Promise<Facts> };

/** Something changed on a stock screen: the next scheduled reading picks it up. */
export function invalidateFacts() {
  if (g.__stockFacts) g.__stockFacts.dirty = true;
}

/** The reading as someone limited to brands sees it: only their brands' styles. Everyone else gets it whole. */
export function factsFor(f: Facts, p: { brands?: string[] }): Facts {
  if (!p.brands?.length) return f;
  const products = f.products.filter((x) => seesBrand(p, x.brand));
  return { ...f, products, byId: new Map(products.map((r) => [r.id, r])) };
}

export function getFacts(opts: { fresh?: boolean } = {}): Promise<Facts> {
  const hit = g.__stockFacts;
  if (hit && !opts.fresh) {
    if (Date.now() - hit.at >= FRESH_MS) refresh().catch((e) => console.error('[stock] reading the range failed', e instanceof Error ? e.message : e));
    return Promise.resolve(hit.facts);
  }
  return refresh();
}

/** Start a reading, or join the one already running. */
function refresh(): Promise<Facts> {
  if (g.__stockFactsNext) return g.__stockFactsNext;
  const t0 = Date.now();
  const p = compute(t0)
    .then((facts) => {
      g.__stockFacts = { at: t0, facts };
      console.log(`[stock] read ${facts.products.length} styles in ${Date.now() - t0}ms`);
      return facts;
    })
    .finally(() => {
      g.__stockFactsNext = undefined;
    });
  g.__stockFactsNext = p;
  return p;
}

const keyDate = (k: string) => new Date(keyToTime(k) + 3 * 86_400_000);

async function compute(now: number): Promise<Facts> {
  const db = await getDb();
  const week = weekOf(now);
  const histFrom = addWeeks(week, -HISTORY);
  const yearsFrom = addWeeks(week, -104);
  const weeks = weekRange(week, addWeeks(week, HORIZON - 1));
  const history = weekRange(histFrom, addWeeks(week, -1));

  const [products, stock, weekly, perLoc, lastSale, catWeeks, open, transit] = await Promise.all([
    db.execute<{
      id: string; market: Market; company: string; style_code: string; title: string; brand: string; category: Category; season: string; image: string | null; currency: string;
      price: number; cost: number; compare_at: number | null; sizes: string[]; size_mix: Record<string, number>; supplier_id: string | null; supplier_name: string | null;
      lead_days: number | null; lead_actual: number | null; deliveries: number | null; moq: number | null; case_pack: number | null; channels: string[]; status: string; launched_at: string;
    }>(sql`
      select p.id, p.market, p.company, p.style_code, p.title, p.brand, p.category, p.season, p.image, p.currency, p.price, p.cost, p.compare_at,
        p.sizes, p.size_mix, p.supplier_id, s.name as supplier_name, s.lead_days, la.lead_actual, la.deliveries, s.moq, s.case_pack, p.channels, p.status, p.launched_at
      from products p left join suppliers s on s.id = p.supplier_id
      -- how long each supplier really takes, from sending the order to its arrival, over the last year
      left join (
        select supplier_id, avg(extract(epoch from received_at - sent_at) / 86400)::float8 as lead_actual, count(*)::int as deliveries
        from purchase_orders where received_at > now() - interval '365 days' and sent_at is not null group by 1
      ) la on la.supplier_id = p.supplier_id
      where p.status = 'active'`),
    db.execute<{ product_id: string; location_id: string; on_hand: number; kind: string }>(sql`
      select sl.product_id, sl.location_id, sum(sl.on_hand)::int as on_hand, max(l.kind) as kind
      from stock_levels sl join locations l on l.id = sl.location_id group by 1, 2`),
    db.execute<{ product_id: string; week: string; units: number; online: number; so: number }>(sql`
      select sw.product_id, sw.week::text as week, sum(sw.units)::int as units,
        coalesce(sum(sw.units) filter (where l.kind = 'warehouse'), 0)::int as online,
        round(avg(sw.stockout_days))::int as so
      from sales_weekly sw join locations l on l.id = sw.location_id
      where sw.week >= ${histFrom} and sw.week < ${week}
      group by 1, 2`),
    db.execute<{ product_id: string; location_id: string; units: number }>(sql`
      select product_id, location_id, sum(units)::int as units from sales_weekly
      where week >= ${addWeeks(week, -8)} and week < ${week} group by 1, 2`),
    db.execute<{ product_id: string; week: string }>(sql`select product_id, max(week)::text as week from sales_weekly where units > 0 group by 1`),
    db.execute<{ market: Market; category: Category; week: string; online: number; store: number }>(sql`
      select p.market, p.category, sw.week::text as week,
        -- what the shelf would have sold: a week half sold out counts as the demand it saw
        coalesce(sum(case when sw.stockout_days between 1 and 6 then sw.units * 7.0 / (7 - sw.stockout_days) else sw.units end) filter (where l.kind = 'warehouse'), 0)::float8 as online,
        coalesce(sum(case when sw.stockout_days between 1 and 6 then sw.units * 7.0 / (7 - sw.stockout_days) else sw.units end) filter (where l.kind <> 'warehouse'), 0)::float8 as store
      from sales_weekly sw join products p on p.id = sw.product_id join locations l on l.id = sw.location_id
      where sw.week >= ${yearsFrom} and sw.week < ${week}
      group by 1, 2, 3`),
    db.execute<{ product_id: string; qty: number; expected_at: string | null; status: string }>(sql`
      select l.product_id, (l.qty - l.received)::int as qty, po.expected_at, po.status
      from po_lines l join purchase_orders po on po.id = l.po_id
      where po.status in ('draft','approval','approved','sent','confirmed','partial') and l.qty > l.received`),
    db.execute<{ product_id: string; qty: number }>(sql`
      select tl.product_id, sum(tl.qty - tl.received)::int as qty from transfer_lines tl join transfers t on t.id = tl.transfer_id
      where t.status in ('picking','in_transit') group by 1`),
  ]);

  // ── seasonality, learned with events taken out so each Eid lands on its own date every year ──
  const index = { EG: {}, KW: {} } as Record<Market, Record<Category, number[]>>;
  for (const m of ['EG', 'KW'] as Market[]) {
    for (const c of CATEGORIES) {
      const units = Array(12).fill(0);
      const seen: Set<string>[] = Array.from({ length: 12 }, () => new Set()); // weeks observed per month
      for (const r of catWeeks.rows) {
        if (r.market !== m || r.category !== c) continue;
        const clean = r.online / eventLift(m, c, r.week, 'online') + r.store / eventLift(m, c, r.week, 'store');
        const d = keyDate(r.week);
        units[d.getUTCMonth()] += clean;
        seen[d.getUTCMonth()].add(r.week);
      }
      index[m][c] = learnIndex(units, seen.map((s) => s.size), priorIndex(m, c));
    }
  }
  const si = (m: Market, c: Category, w: string, onlineShare: number) => {
    const d = keyDate(w);
    const base = indexOn(index[m][c], d.getUTCMonth(), d.getUTCDate());
    const lift = onlineShare * eventLift(m, c, w, 'online') + (1 - onlineShare) * eventLift(m, c, w, 'store');
    return base * lift;
  };

  // ── group the rows by style ──
  const stockBy = new Map<string, Record<string, { onHand: number; rate: number; kind: string }>>();
  for (const r of stock.rows) {
    const m = stockBy.get(r.product_id) ?? {};
    m[r.location_id] = { onHand: r.on_hand, rate: 0, kind: r.kind };
    stockBy.set(r.product_id, m);
  }
  for (const r of perLoc.rows) {
    const m = stockBy.get(r.product_id) ?? {};
    m[r.location_id] = { ...(m[r.location_id] ?? { onHand: 0, kind: 'store' }), rate: r.units / 8 };
    stockBy.set(r.product_id, m);
  }
  const weeklyBy = new Map<string, Map<string, { units: number; online: number; so: number }>>();
  for (const r of weekly.rows) {
    const m = weeklyBy.get(r.product_id) ?? new Map();
    m.set(r.week, { units: r.units, online: r.online, so: r.so });
    weeklyBy.set(r.product_id, m);
  }
  const lastSaleBy = new Map(lastSale.rows.map((r) => [r.product_id, r.week]));
  const transitBy = new Map(transit.rows.map((r) => [r.product_id, r.qty]));
  const openBy = new Map<string, { onOrder: number; inDraft: number; arrivals: Record<string, number> }>();
  for (const r of open.rows) {
    const o = openBy.get(r.product_id) ?? { onOrder: 0, inDraft: 0, arrivals: {} };
    if (r.status === 'draft' || r.status === 'approval') o.inDraft += r.qty;
    else {
      o.onOrder += r.qty;
      const wk = r.expected_at ? weekOf(new Date(r.expected_at)) : addWeeks(week, 4);
      const at = wk < week ? week : wk;
      o.arrivals[at] = (o.arrivals[at] ?? 0) + r.qty;
    }
    openBy.set(r.product_id, o);
  }

  const elapsed = Math.min(6, Math.floor((now - keyToTime(week)) / 86_400_000));
  const firstWeekLeft = (7 - elapsed) / 7;

  const rows: ProductFacts[] = products.rows.map((p) => {
    const hist = weeklyBy.get(p.id) ?? new Map();
    const launched = new Date(p.launched_at);
    const launchWeek = weekOf(launched);
    const obs: WeekObs[] = history.filter((w) => w >= launchWeek).map((w) => ({ week: w, units: hist.get(w)?.units ?? 0, stockoutDays: hist.get(w)?.so ?? 0 }));
    const totals = obs.reduce((a, o) => a + o.units, 0);
    const online = history.reduce((a, w) => a + (hist.get(w)?.online ?? 0), 0);
    const onlineShare = totals > 0 ? online / totals : p.channels.length ? 0.35 : 0;
    const siP = (w: string) => si(p.market, p.category, w, onlineShare);
    const { rate: base, sigma } = baseRate(obs, siP, 8);
    const trend = trendFactor(obs, siP);
    const fc = forecastWeeks(base, trend, weeks, siP);
    fc[0] *= firstWeekLeft;
    const locs = stockBy.get(p.id) ?? {};
    const onHand = Object.values(locs).reduce((a, l) => a + Math.max(0, l.onHand), 0);
    const warehouseOnHand = Object.values(locs).reduce((a, l) => a + (l.kind === 'warehouse' ? Math.max(0, l.onHand) : 0), 0);
    const ord = openBy.get(p.id) ?? { onOrder: 0, inDraft: 0, arrivals: {} };
    const proj = project(onHand, weeks, fc, ord.arrivals);
    const sum = (n: number) => obs.slice(-n).reduce((a, o) => a + o.units, 0);
    const last = lastSaleBy.get(p.id);
    const weeksLive = Math.max(0, Math.round((now - launched.getTime()) / (7 * 86_400_000)));
    const revenue13 = sum(13) * p.price;
    return {
      id: p.id,
      market: p.market,
      company: p.company,
      styleCode: p.style_code,
      title: p.title,
      brand: p.brand,
      category: p.category,
      season: p.season,
      image: p.image,
      currency: p.currency,
      price: Number(p.price),
      cost: Number(p.cost),
      compareAt: p.compare_at == null ? null : Number(p.compare_at),
      margin: Number(p.price) > 0 ? 1 - Number(p.cost) / Number(p.price) : 0,
      sizes: p.sizes,
      sizeMix: p.size_mix,
      supplierId: p.supplier_id,
      supplierName: p.supplier_name,
      // the promised lead time until two deliveries have shown the real one; never under 80% of the promise
      leadDays: p.lead_actual != null && (p.deliveries ?? 0) >= 2 ? Math.round(Math.max((p.lead_days ?? 42) * 0.8, p.lead_actual)) : p.lead_days ?? 42,
      moq: p.moq ?? 0,
      casePack: p.case_pack ?? 1,
      channels: p.channels,
      status: p.status,
      launchedAt: launched,
      onHand,
      byLocation: Object.fromEntries(Object.entries(locs).map(([k, v]) => [k, { onHand: v.onHand, rate: v.rate }])),
      warehouseOnHand,
      onOrder: ord.onOrder,
      inDraft: ord.inDraft,
      arrivals: ord.arrivals,
      inTransit: transitBy.get(p.id) ?? 0,
      weekly: obs,
      onlineShare,
      sold4: sum(4),
      sold8: sum(8),
      sold13: sum(13),
      revenue13: Number(revenue13),
      base,
      trend,
      sigma,
      rate: fc[1] ?? fc[0],
      forecast: fc,
      cover: weeksOfCover(onHand, fc.slice(1).length ? [fc[0] / firstWeekLeft, ...fc.slice(1)] : fc),
      stockout: stockoutWeek(proj),
      sellThrough8: sellThrough(sum(8), onHand),
      weeksLive,
      weeksSinceSale: last ? Math.max(0, Math.round((keyToTime(week) - keyToTime(last)) / (7 * 86_400_000)) - 1) : null,
      abc: 'C',
      xyz: xyz(obs.slice(-13).map((o) => o.units)),
      velocity: 'steady',
      valueCostEgp: egpMinor(onHand * Number(p.cost), p.currency),
      valueRetailEgp: egpMinor(onHand * Number(p.price), p.currency),
    };
  });

  // ABC within each market, velocity against each category's median rate
  for (const m of ['EG', 'KW'] as Market[]) {
    const inM = rows.filter((r) => r.market === m);
    const ranks = abc(inM.map((r) => ({ id: r.id, revenue: r.revenue13 })));
    for (const r of inM) r.abc = ranks[r.id];
    for (const c of CATEGORIES) {
      const inC = inM.filter((r) => r.category === c && r.weeksLive >= 6);
      const med = median(inC.map((r) => r.rate));
      for (const r of inM.filter((x) => x.category === c)) {
        r.velocity = velocity({ rate: r.rate, categoryMedian: med, weeksLive: r.weeksLive, weeksSinceSale: r.weeksSinceSale, onHand: r.onHand, cover: r.cover });
      }
    }
  }

  return { at: now, week, firstWeekLeft, weeks, history, products: rows, byId: new Map(rows.map((r) => [r.id, r])), index, si };
}
