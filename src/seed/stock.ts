// The demo stockroom: two years of weekly sales across the websites and every shop, today's stock in
// the warehouses and on the counters, the suppliers and their purchase orders, the transfers in
// flight, and a month of the team's work. Built after the order floor (demo.ts) so the last month of
// website sales is the real demo orders, rolled up. Kuwait counters are the D&H and D&Co store list.
// Every figure is fictional; the products and the shops are real.
import { sql } from 'drizzle-orm';
import { getDb, schema } from '../lib/db';
import { branchesFor, sameBrand } from '../lib/domain/branches';
import { addDays, addWeeks, eventLift, keyToTime, markdownShare, weekOf, weekRange, type Market } from '../lib/domain/stock/calendar';
import { indexOn, priorIndex, type Category } from '../lib/domain/stock/categories';
import { estimateMinutes, type TaskKind } from '../lib/domain/stock/work';
import { inEgp, toMinor } from '../lib/format';
import { rollupOnlineSales } from '../lib/stock/rollup';
import { runPlanner } from '../lib/stock/planner';
import { invalidateFacts } from '../lib/stock/facts';
import { catalogueChanged } from '../lib/stock/hooks';
import { CHANNEL } from '../lib/channels';
import { sortSizes } from '../lib/domain/stock/sizes';
import { CATALOG, SOURCES, categoryOf, hash, isDead, popularity, seasonOf, webWeight, type CatalogItem } from './model';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

// ── deterministic randomness ──
let seed = 77;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => a + rnd() * (b - a);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
function poisson(l: number) {
  if (l <= 0) return 0;
  if (l > 40) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss()));
  const L = Math.exp(-l);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rnd();
  } while (p > L);
  return k - 1;
}
function gauss() {
  const u = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

// ── places ──
type Loc = { id: string; kind: 'warehouse' | 'store'; name: string; company: 'DH' | 'DCO' | 'FIG'; country: Market; currency: string; city: string; area?: string; brands: string[]; phone?: string; traffic: number };

const DCO = ['La Vie en Rose', 'Hunkemoller', 'Bimba Y Lola', 'Bebe'];
const companyOfBrand = (b: string) => (DCO.some((x) => sameBrand(x, b)) ? 'DCO' : 'DH');
const MALL_TRAFFIC: Record<string, number> = { 'Avenues Mall': 1.35, '360 Mall': 1.15, 'Gate Mall': 0.6, 'Mohalab Mall': 0.8, 'Al Kout Mall': 0.85, 'Marina Mall': 0.9, 'Warehouse Mall': 0.7, 'Araya Mall': 0.65 };

function places(): Loc[] {
  return [
    { id: 'fig-cairo', kind: 'warehouse', name: 'FIG warehouse · New Cairo', company: 'FIG', country: 'EG', currency: 'EGP', city: 'New Cairo', brands: [], traffic: 1 },
    { id: 'dh-kuwait', kind: 'warehouse', name: 'D&H warehouse · Kuwait', company: 'DH', country: 'KW', currency: 'KWD', city: 'Kuwait', brands: [], traffic: 1 },
    { id: 'fig-moe', kind: 'store', name: 'FIG · Mall of Egypt', company: 'FIG', country: 'EG', currency: 'EGP', city: '6th of October', area: 'Mall of Egypt', brands: [], traffic: 1.25 },
    { id: 'fig-citystars', kind: 'store', name: 'FIG · City Stars', company: 'FIG', country: 'EG', currency: 'EGP', city: 'Nasr City', area: 'City Stars', brands: [], traffic: 1.1 },
    { id: 'fig-cfc', kind: 'store', name: 'FIG · Cairo Festival City', company: 'FIG', country: 'EG', currency: 'EGP', city: 'New Cairo', area: 'Cairo Festival City', brands: [], traffic: 1 },
    { id: 'fig-sanstefano', kind: 'store', name: 'FIG · San Stefano', company: 'FIG', country: 'EG', currency: 'EGP', city: 'Alexandria', area: 'San Stefano Grand Plaza', brands: [], traffic: 0.75 },
    ...branchesFor('Labesny', 'KW').map(
      (b): Loc => ({ id: b.id, kind: 'store', name: b.name, company: companyOfBrand(b.brands?.[0] ?? ''), country: 'KW', currency: 'KWD', city: 'Kuwait', area: b.area, brands: b.brands ?? [], phone: b.phone, traffic: MALL_TRAFFIC[b.area] ?? 0.8 }),
    ),
  ];
}

// ── suppliers: the brand principals ──
type Sup = { key: string; name: string; country: string; currency: string; brands: string[]; lead: number; moq: number; pack: number; terms: string; delay: number; sd: number; fill: number };
const SUPPLIERS: Sup[] = [
  { key: 'tendam', name: "Tendam · Women'secret & Springfield", country: 'ES', currency: 'EUR', brands: ['Women Secret', 'Springfield'], lead: 35, moq: 24, pack: 6, terms: '60 days from delivery', delay: -1, sd: 2, fill: 0.98 },
  { key: 'etam', name: 'Etam Lingerie', country: 'FR', currency: 'EUR', brands: ['Etam'], lead: 40, moq: 18, pack: 6, terms: '45 days from invoice', delay: 2, sd: 3, fill: 0.96 },
  { key: 'hunk', name: 'Hunkemöller International', country: 'NL', currency: 'EUR', brands: ['Hunkemoller'], lead: 38, moq: 18, pack: 6, terms: '60 days from delivery', delay: 1, sd: 2, fill: 0.97 },
  { key: 'lver', name: 'La Vie en Rose', country: 'CA', currency: 'CAD', brands: ['La vie en Rose'], lead: 56, moq: 24, pack: 6, terms: '30% deposit, balance on shipping', delay: 9, sd: 4, fill: 0.93 },
  { key: 'benetton', name: 'Benetton Group', country: 'IT', currency: 'EUR', brands: ['Benetton'], lead: 42, moq: 12, pack: 6, terms: '60 days from delivery', delay: 3, sd: 3, fill: 0.95 },
  { key: 'bebe', name: 'bebe stores', country: 'US', currency: 'USD', brands: ['Bebe'], lead: 58, moq: 12, pack: 3, terms: 'Letter of credit', delay: 6, sd: 5, fill: 0.91 },
  { key: 'f21', name: 'Forever 21 · franchise supply', country: 'US', currency: 'USD', brands: ['Forever 21'], lead: 60, moq: 24, pack: 6, terms: 'Letter of credit', delay: 5, sd: 6, fill: 0.9 },
  { key: 'maxmara', name: 'Max Mara Fashion Group · Marina Rinaldi', country: 'IT', currency: 'EUR', brands: ['Marina Rinaldi'], lead: 49, moq: 4, pack: 1, terms: '30 days from invoice', delay: 0, sd: 2, fill: 0.99 },
  { key: 'carpisa', name: 'Carpisa', country: 'IT', currency: 'EUR', brands: ['Carpisa'], lead: 42, moq: 12, pack: 6, terms: '60 days from delivery', delay: 2, sd: 2, fill: 0.97 },
  { key: 'bsb', name: 'BSB Fashion', country: 'GR', currency: 'EUR', brands: ['BSB'], lead: 28, moq: 18, pack: 6, terms: '45 days from invoice', delay: 1, sd: 3, fill: 0.95 },
  { key: 'lipsy', name: 'Lipsy London', country: 'GB', currency: 'GBP', brands: ['Lipsy London'], lead: 35, moq: 18, pack: 6, terms: '60 days from delivery', delay: 3, sd: 3, fill: 0.94 },
  { key: 'desigual', name: 'Desigual', country: 'ES', currency: 'EUR', brands: ['Desigual'], lead: 38, moq: 12, pack: 6, terms: '60 days from delivery', delay: 2, sd: 2, fill: 0.96 },
];

// ── the range ──
type Prod = {
  id?: string;
  key: string; // market:styleCode
  market: Market;
  company: string;
  styleCode: string;
  item: CatalogItem;
  category: Category;
  season: string;
  launched: number;
  ends: number | null; // last season's twin stops selling
  price: number;
  cost: number;
  currency: string;
  sizes: string[];
  mix: Record<string, number>;
  channels: string[];
  supplier: Sup | undefined;
  pop: number;
  dead: boolean;
  twin: boolean;
  status: 'active' | 'discontinued';
  locs: Loc[];
  variantIds: string[];
};

const LETTER_W: Record<string, number> = { XXS: 0.03, XS: 0.09, S: 0.2, 'S/M': 0.4, M: 0.3, 'M/L': 0.4, L: 0.24, 'L/XL': 0.25, XL: 0.12, XXL: 0.05, XXXL: 0.02 };
function sizeMix(sizes: string[]): Record<string, number> {
  if (sizes.length <= 1) return Object.fromEntries(sizes.map((s) => [s, 1]));
  const w = sizes.map((s, i) => LETTER_W[s.toUpperCase()] ?? Math.exp(-(((i - (sizes.length - 1) / 2) / (sizes.length / 3)) ** 2)));
  const t = w.reduce((a, b) => a + b, 0);
  return Object.fromEntries(sizes.map((s, i) => [s, Math.round((w[i] / t) * 1000) / 1000]));
}
const slug = (s: string) => s.toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const barcodeFor = (k: string) => `2${String(Math.floor(hash(k, 9) * 1e12)).padStart(12, '0')}`;

export async function seedStock(opts: { log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const db = await getDb();
  seed = 77;
  const now = Date.now();
  const thisWeek = weekOf(now);
  const startWeek = addWeeks(thisWeek, -104);
  const elapsed = Math.min(1, Math.max(0.1, (now - keyToTime(thisWeek)) / (7 * DAY)));

  // Only demo data lives here today; a live catalogue would be kept and only demo rows replaced.
  const [{ live }] = (await db.execute<{ live: number }>(sql`select count(*)::int as live from products where source <> 'demo'`)).rows;
  if (live > 0) throw new Error('A live catalogue is connected: the demo stockroom will not overwrite it.');
  log('Clearing the stockroom…');
  await db.execute(sql`truncate placement_daily, placements, recommendations, activity, tasks, transfer_lines, transfers, po_lines, purchase_orders, stock_moves, sales_weekly, stock_levels, variants, products, suppliers, locations`);

  // ── places & suppliers ──
  const locs = places();
  await db.insert(schema.locations).values(locs.map((l) => ({ id: l.id, kind: l.kind, name: l.name, company: l.company, country: l.country, currency: l.currency, city: l.city, area: l.area ?? null, brands: l.brands, phone: l.phone ?? null, source: 'demo' })));
  const supIds = new Map<string, string>();
  for (const s of SUPPLIERS) {
    const [row] = await db.insert(schema.suppliers).values({ name: s.name, country: s.country, currency: s.currency, brands: s.brands, leadDays: s.lead, moq: s.moq, casePack: s.pack, paymentTerms: s.terms, source: 'demo' }).returning({ id: schema.suppliers.id });
    supIds.set(s.key, row.id);
  }

  // ── products ──
  log('Building the range…');
  const prods: Prod[] = [];
  const byKey = new Map<string, Prod>();
  for (const src of SOURCES) {
    const items = CATALOG[src.key];
    for (const item of items) {
      const key = `${src.market}:${item.sku}`;
      const exist = byKey.get(key);
      if (exist) {
        exist.channels = [...new Set([...exist.channels, ...src.channels])];
        continue;
      }
      const s = seasonOf(item, src.market);
      const category = categoryOf(item);
      const currency = src.market === 'EG' ? 'EGP' : 'KWD';
      const price = toMinor(item.price, currency);
      const sizes = sortSizes(item.sizes);
      const sup = SUPPLIERS.find((x) => x.brands.some((b) => sameBrand(b, item.brand)));
      const company = src.market === 'EG' ? 'FIG' : companyOfBrand(item.brand);
      const base: Prod = {
        key,
        market: src.market,
        company,
        styleCode: item.sku,
        item,
        category,
        season: s.season,
        launched: Date.parse(`${s.launched}T08:00:00Z`),
        ends: null,
        price,
        cost: Math.round(price * (0.33 + hash(item.brand, 2) * 0.13)),
        currency,
        sizes,
        mix: sizeMix(sizes),
        channels: [...src.channels],
        supplier: sup,
        pop: popularity(key),
        dead: isDead(item, src.market),
        twin: false,
        status: 'active',
        locs: [],
        variantIds: [],
      };
      byKey.set(key, base);
      prods.push(base);
      // last year's version of a seasonal style: same look, last season's code, sold out and gone
      if (s.season !== 'core') {
        const last = s.season.replace('26', '25');
        const launched = base.launched - 364 * DAY;
        const ends = last.startsWith('AW') ? Date.parse('2026-03-01T00:00:00Z') : Date.parse('2025-11-01T00:00:00Z');
        const twin: Prod = { ...base, key: `${key}-25`, styleCode: `${item.sku}-25`, season: last, launched, ends, twin: true, status: 'discontinued', dead: false, pop: popularity(`${key}-25`) * 0.9 + base.pop * 0.3, locs: [], variantIds: [] };
        byKey.set(twin.key, twin);
        prods.push(twin);
        // and the autumn range before that, so the first year of history has its winter too
        if (s.season === 'AW26') {
          const old: Prod = { ...base, key: `${key}-24`, styleCode: `${item.sku}-24`, season: 'AW24', launched: base.launched - 728 * DAY, ends: Date.parse('2025-03-01T00:00:00Z'), twin: true, status: 'discontinued', dead: false, pop: popularity(`${key}-24`) * 0.9 + base.pop * 0.3, locs: [], variantIds: [] };
          byKey.set(old.key, old);
          prods.push(old);
        }
      }
    }
  }

  // where each style sells: its market's warehouse (the websites) and the shops that carry the brand
  for (const p of prods) {
    p.locs = locs.filter((l) => l.country === p.market && (l.kind === 'warehouse' || !l.brands.length || l.brands.some((b) => sameBrand(b, p.item.brand))));
  }

  for (let i = 0; i < prods.length; i += 300) {
    const chunk = prods.slice(i, i + 300);
    const rows = await db
      .insert(schema.products)
      .values(
        chunk.map((p) => ({
          market: p.market,
          company: p.company,
          styleCode: p.styleCode,
          title: p.item.title.replace(/&amp;/g, '&'),
          brand: p.item.brand,
          category: p.category,
          season: p.season,
          image: p.item.image,
          currency: p.currency,
          price: p.price,
          cost: p.cost,
          compareAt: p.item.compareAt ? toMinor(p.item.compareAt, p.currency) : null,
          sizes: p.sizes,
          sizeMix: p.mix,
          supplierId: p.supplier ? supIds.get(p.supplier.key) ?? null : null,
          channels: p.channels,
          handle: `${slug(p.item.title)}-${p.styleCode.slice(-4).toLowerCase()}`,
          status: p.status,
          launchedAt: new Date(p.launched),
          source: 'demo',
        })),
      )
      .returning({ id: schema.products.id });
    chunk.forEach((p, k) => (p.id = rows[k].id));
  }
  const variantRows: (typeof schema.variants.$inferInsert)[] = [];
  for (const p of prods) {
    const sizes = p.sizes.length ? p.sizes : [null];
    sizes.forEach((size, i) => variantRows.push({ productId: p.id!, sku: size ? `${p.styleCode}-${size}` : p.styleCode, barcode: barcodeFor(`${p.key}:${size}`), size, sizeIdx: i }));
  }
  const vByProduct = new Map<string, { id: string; size: string | null }[]>();
  for (let i = 0; i < variantRows.length; i += 1000) {
    const rows = await db.insert(schema.variants).values(variantRows.slice(i, i + 1000)).returning({ id: schema.variants.id, productId: schema.variants.productId, size: schema.variants.size });
    for (const r of rows) vByProduct.set(r.productId, [...(vByProduct.get(r.productId) ?? []), { id: r.id, size: r.size }]);
  }
  log(`  ${prods.filter((p) => !p.twin).length} live styles, ${prods.filter((p) => p.twin).length} from last season, ${variantRows.length} sizes`);

  // ── demand model ──
  const current = prods.filter((p) => !p.twin);
  const UNITS_PER_ORDER = 1.9;
  const ONLINE_ORDERS: Record<string, number> = { fig: 20, wsEg: 6, labesny: 11, wsKw: 3 };
  const srcOf = (p: Prod) => (p.market === 'EG' ? (p.channels.includes('ws-eg') && !p.channels.includes('fig-web') ? 'wsEg' : 'fig') : p.channels.includes('ws-kw') ? 'wsKw' : 'labesny');
  const nowDate = new Date(now);
  const K: Record<string, number> = {};
  for (const key of Object.keys(ONLINE_ORDERS)) {
    const pool = current.filter((p) => srcOf(p) === key);
    const w = pool.reduce((s, p) => s + webWeight(p.item, p.market, nowDate), 0);
    K[key] = (ONLINE_ORDERS[key] * 7 * UNITS_PER_ORDER) / Math.max(1, w);
  }
  // shops: a multi-brand FIG store moves ~420 pieces a week, a Kuwait counter ~170, before traffic and season
  const popSum = new Map<string, number>();
  for (const l of locs) if (l.kind === 'store') popSum.set(l.id, current.filter((p) => p.locs.includes(l)).reduce((s, p) => s + p.pop, 0));
  const affinity = (p: Prod, l: Loc) => 0.55 + hash(`${p.key}@${l.id}`, 21) * 0.9;

  const life = (p: Prod, t: number) => {
    if (t < p.launched) return 0;
    if (p.ends && t > p.ends) return 0;
    const weeks = (t - p.launched) / (7 * DAY);
    let f = weeks < 2 ? 0.7 : 1;
    if (p.season.startsWith('SS') && new Date(t).getUTCMonth() >= 9) f *= 0.6; // broken sizes by autumn
    if (p.twin && p.season.startsWith('AW') && new Date(t).getUTCMonth() === 1) f *= 0.7;
    return f;
  };
  const deadFrom = keyToTime(addWeeks(thisWeek, -14));
  const idx = (p: Prod, week: string) => {
    const d = new Date(`${week}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 3);
    return indexOn(priorIndex(p.market, p.category), d.getUTCMonth(), d.getUTCDate());
  };
  const lambda = (p: Prod, l: Loc, week: string) => {
    const t = keyToTime(week) + 3.5 * DAY;
    const lf = life(p, t);
    if (!lf) return 0;
    const years = (t - now) / (365 * DAY);
    const dead = p.dead && t > deadFrom ? 0.03 : 1;
    if (l.kind === 'warehouse') {
      if (!p.channels.length) return 0;
      const growth = (p.market === 'EG' ? 1.35 : 1.25) ** years;
      return K[srcOf(p)] * p.pop * idx(p, week) * eventLift(p.market, p.category, week, 'online') * growth * lf * dead;
    }
    const perStore = (l.country === 'EG' ? 420 : 170) * l.traffic;
    const growth = (l.country === 'EG' ? 1.04 : 1.02) ** years;
    return ((perStore * p.pop) / Math.max(1, popSum.get(l.id) ?? 1)) * affinity(p, l) * idx(p, week) * eventLift(p.market, p.category, week, 'store') * growth * lf * dead;
  };

  // last November's short: the pyjamas that sold out in Egypt, and the Hunkemöller bras in Kuwait
  const shortEg = new Set(
    prods
      .filter((p) => p.twin && p.market === 'EG' && p.category === 'nightwear' && p.season === 'AW25')
      .sort((a, b) => b.pop - a.pop)
      .slice(0, 8)
      .map((p) => p.key),
  );
  const shortKw = new Set(
    current
      .filter((p) => p.market === 'KW' && sameBrand(p.item.brand, 'Hunkemoller') && p.category === 'lingerie')
      .sort((a, b) => b.pop - a.pop)
      .slice(0, 4)
      .map((p) => p.key),
  );
  const stockout = (p: Prod, l: Loc, week: string) => {
    if (shortEg.has(p.key) && week >= '2025-11-09' && week <= '2025-12-07') return l.kind === 'warehouse' ? 7 : 5;
    if (shortEg.has(p.key) && week === '2025-12-14') return 3;
    if (shortKw.has(p.key) && week >= '2025-11-23' && week <= '2025-11-30') return l.kind === 'warehouse' ? 7 : 4;
    return 0;
  };
  const swimEg = (p: Prod) => p.market === 'EG' && p.category === 'swimwear' && p.season === 'SS25';

  // ── two years of weekly sales ──
  log('Writing two years of weekly sales…');
  const ordersFrom = (await db.execute<{ t: string | null }>(sql`select min(placed_at)::text as t from orders where source = 'demo'`)).rows[0]?.t;
  const rollFrom = ordersFrom ? addWeeks(weekOf(new Date(ordersFrom)), 1) : addWeeks(thisWeek, 1);
  const weeks = weekRange(startWeek, thisWeek);
  const sold = new Map<string, number>(); // product key → units, for sizing last year's buys
  const soldIn = (k: string, n: number) => sold.set(k, (sold.get(k) ?? 0) + n);
  let rows: (typeof schema.salesWeekly.$inferInsert)[] = [];
  let written = 0;
  const flush = async () => {
    for (let i = 0; i < rows.length; i += 1500) await db.insert(schema.salesWeekly).values(rows.slice(i, i + 1500));
    written += rows.length;
    rows = [];
  };
  for (const p of prods) {
    for (const l of p.locs) {
      for (const week of weeks) {
        if (l.kind === 'warehouse' && week >= rollFrom) continue; // the demo orders fill these
        let lam = lambda(p, l, week);
        if (week === thisWeek) lam *= elapsed;
        const out = stockout(p, l, week);
        let units = poisson(lam * (1 - out / 7));
        if (!units && !out) continue;
        let md = Math.round(units * markdownShare(p.market, week));
        if (swimEg(p) && week >= '2025-07-27' && week <= '2025-10-26') {
          // last summer's swimwear: bought too deep, most of August went out at half price
          units = poisson(lam * 1.15);
          md = Math.round(units * 0.68);
        }
        soldIn(`${p.key}|${week.slice(0, 7)}`, units);
        soldIn(p.key, units);
        rows.push({ week, productId: p.id!, locationId: l.id, units, revenue: Math.round(p.price * (units - md) + p.price * 0.6 * md), cost: p.cost * units, stockoutDays: out, markdownUnits: md });
        if (rows.length >= 6000) await flush();
      }
    }
  }
  await flush();
  log(`  ${written.toLocaleString('en')} store and website weeks`);
  const rolled = await rollupOnlineSales(rollFrom);
  log(`  ${rolled} website weeks from the demo orders`);

  // ── today's stock ──
  log('Counting today’s stock…');
  const nextRate = (p: Prod, l: Loc) => {
    let s = 0;
    for (let i = 1; i <= 4; i++) s += lambda(p, l, addWeeks(thisWeek, i));
    return s / 4;
  };
  const summerRate = (p: Prod, l: Loc) => lambda({ ...p, launched: 0, ends: null, dead: false }, l, `${new Date(now).getUTCFullYear()}-07-12`);
  const popRank = new Map<string, number>();
  for (const src of ['fig', 'wsEg', 'labesny', 'wsKw']) {
    const pool = current.filter((p) => srcOf(p) === src).sort((a, b) => b.pop - a.pop);
    pool.forEach((p, i) => popRank.set(p.key, i / Math.max(1, pool.length - 1)));
  }
  const levelRows: (typeof schema.stockLevels.$inferInsert)[] = [];
  const onHandOf = new Map<string, number>(); // `${productId}@${locationId}`
  for (const p of current) {
    const vars = vByProduct.get(p.id!) ?? [];
    for (const l of p.locs) {
      const r = nextRate(p, l);
      let cover = l.kind === 'warehouse' ? between(7, 13) : between(5, 11);
      const hot = p.season === 'AW26' && ['nightwear', 'knitwear', 'outerwear'].includes(p.category) && (popRank.get(p.key) ?? 1) < 0.25;
      if (hot) cover = l.kind === 'warehouse' ? between(2, 4.5) : between(2.5, 5);
      if (l.area === 'Gate Mall' && hash(p.key, 31) < 0.5) cover *= 3.6;
      if (l.area === 'Avenues Mall' && hash(p.key, 32) < 0.5) cover *= 0.22;
      if (l.id === 'fig-sanstefano' && hash(p.key, 33) < 0.3) cover *= 3;
      if (l.id === 'fig-moe' && hash(p.key, 34) < 0.3) cover *= 0.25;
      let total = Math.round(r * cover);
      if (p.season === 'SS26') total = Math.round(summerRate(p, l) * between(5, 9) * (l.kind === 'warehouse' ? 1 : 0.6));
      if (p.dead) total = l.kind === 'warehouse' ? Math.round(between(18, 60)) : Math.round(between(3, 12));
      if (!r && !p.dead && p.season !== 'SS26') total = chance(0.3) ? Math.round(between(1, 5)) : 0;
      if (total <= 0) continue;
      onHandOf.set(`${p.id}@${l.id}`, total);
      // across sizes, by the curve, with the odd broken size run on the shop floor
      const sizes = vars.map((v) => v.size ?? '');
      const holes = l.kind === 'store' && sizes.length >= 4 && chance(0.12) ? [Math.floor(sizes.length / 2)] : [];
      const w = sizes.map((s, i) => (holes.includes(i) ? 0 : (p.mix[s] ?? 1 / sizes.length) * between(0.7, 1.3)));
      const wt = w.reduce((a, b) => a + b, 0) || 1;
      let left = total;
      vars.forEach((v, i) => {
        const q = i === vars.length - 1 ? left : Math.min(left, Math.round((total * w[i]) / wt));
        left -= q;
        const counted = l.kind === 'warehouse' ? (chance(0.7) ? now - between(5, 75) * DAY : null) : chance(0.35) ? now - between(10, 160) * DAY : null;
        if (q > 0 || counted) levelRows.push({ variantId: v.id, productId: p.id!, locationId: l.id, onHand: Math.max(0, q), countedAt: counted ? new Date(counted) : null, bin: l.kind === 'warehouse' ? `${'ABCDEFGH'[Math.floor(hash(p.key, 4) * 8)]}-${String(1 + Math.floor(hash(p.key, 6) * 24)).padStart(2, '0')}-${1 + (i % 4)}` : null, updatedAt: new Date(now - between(0, 6) * DAY) });
      });
    }
  }
  // two sizes in Kuwait that show less than nothing: a sale booked twice, as happens
  const negatives = levelRows.filter((r) => r.locationId === 'dh-kuwait' && (r.onHand ?? 0) > 0).slice(40, 42);
  negatives.forEach((r, i) => (r.onHand = -1 - i));
  for (let i = 0; i < levelRows.length; i += 1500) await db.insert(schema.stockLevels).values(levelRows.slice(i, i + 1500));
  log(`  ${levelRows.length.toLocaleString('en')} shelf positions`);

  // ── staff ──
  const users = await db.select().from(schema.users);
  const u = (email: string) => users.find((x) => x.email === `${email}@relay.local`);
  const buyerFor = (m: Market) => (m === 'EG' ? u('tarek') : u('noura'));
  const hala = u('hala');

  // ── purchase orders: two years of history, and what is open today ──
  log('Writing the purchase orders…');
  let poSeq = 0;
  const poNumber = (t: number) => `PO-${String(new Date(t).getUTCFullYear()).slice(2)}-${String(++poSeq).padStart(4, '0')}`;
  type Line = { p: Prod; qty: number };
  const moves: (typeof schema.stockMoves.$inferInsert)[] = [];
  const makePo = async (o: { sup: Sup; market: Market; lines: Line[]; status: string; created: number; sent?: number | null; expected: number; received?: number | null; fill?: number; source?: string; reason?: string; partial?: number }) => {
    const lines = o.lines.filter((l) => l.qty > 0);
    if (!lines.length) return null;
    const wh = o.market === 'EG' ? 'fig-cairo' : 'dh-kuwait';
    const buyer = buyerFor(o.market);
    const total = lines.reduce((s, l) => s + l.qty * l.p.cost, 0);
    const units = lines.reduce((s, l) => s + l.qty, 0);
    const closed = o.status === 'closed' || o.status === 'received';
    const [po] = await db
      .insert(schema.purchaseOrders)
      .values({
        number: poNumber(o.created),
        supplierId: supIds.get(o.sup.key)!,
        locationId: wh,
        company: o.market === 'EG' ? 'FIG' : companyOfBrand(o.sup.brands[0]),
        market: o.market,
        currency: o.market === 'EG' ? 'EGP' : 'KWD',
        status: o.status,
        total,
        units,
        season: lines[0].p.season === 'core' ? null : lines[0].p.season,
        source: o.source ?? 'manual',
        reason: o.reason ?? null,
        expectedAt: new Date(o.expected),
        sentAt: o.sent ? new Date(o.sent) : null,
        confirmedAt: o.sent && !['sent', 'approved', 'approval', 'draft'].includes(o.status) ? new Date(o.sent + between(1, 4) * DAY) : null,
        receivedAt: o.received ? new Date(o.received) : null,
        closedAt: o.status === 'closed' && o.received ? new Date(o.received + between(2, 9) * DAY) : null,
        createdBy: buyer?.id ?? null,
        createdByName: o.source === 'ai' ? 'AI planner' : buyer?.name ?? 'Buyer',
        approvedBy: ['draft', 'approval'].includes(o.status) ? null : hala?.id ?? null,
        approvedByName: ['draft', 'approval'].includes(o.status) ? null : hala?.name ?? null,
        approvedAt: ['draft', 'approval'].includes(o.status) ? null : new Date(o.created + between(2, 30) * HOUR),
        createdAt: new Date(o.created),
        updatedAt: new Date(o.received ?? o.sent ?? o.created),
      })
      .returning();
    const lineRows: (typeof schema.poLines.$inferInsert)[] = [];
    for (const l of lines) {
      const vars = vByProduct.get(l.p.id!) ?? [];
      const split = vars.map((v) => ({ v, n: Math.round(l.qty * (l.p.mix[v.size ?? ''] ?? 1 / vars.length)) }));
      for (const { v, n } of split) {
        if (n <= 0) continue;
        const got = closed ? Math.round(n * Math.min(1, (o.fill ?? 1) + between(-0.03, 0.03))) : o.partial ? Math.round(n * o.partial) : 0;
        const damaged = closed && chance(0.08) ? 1 : 0;
        lineRows.push({ poId: po.id, productId: l.p.id!, variantId: v.id, qty: n, received: Math.max(0, got - damaged), damaged, unitCost: l.p.cost });
        if ((closed || o.partial) && got > 0 && (o.received ?? 0) > now - 150 * DAY) {
          moves.push({ at: new Date(o.received ?? now), variantId: v.id, productId: l.p.id!, locationId: wh, qty: got - damaged, kind: 'receive', refType: 'po', refId: po.id, actorName: o.market === 'EG' ? 'Omar Saeed' : 'Fatma Al-Enezi', actorId: (o.market === 'EG' ? u('omar') : u('fatma'))?.id ?? null, note: po.number });
        }
      }
    }
    if (lineRows.length) await db.insert(schema.poLines).values(lineRows);
    await db.execute(sql`update purchase_orders set total = (select coalesce(sum(qty * unit_cost), 0) from po_lines where po_id = ${po.id}), units = (select coalesce(sum(qty), 0) from po_lines where po_id = ${po.id}) where id = ${po.id}`);
    return po;
  };

  // seasonal buys: each season's styles bought once, ahead of launch; last summer's swimwear twice as deep as it sold
  const seasonal = prods.filter((p) => p.season !== 'core' && p.supplier);
  const groups = new Map<string, Prod[]>();
  for (const p of seasonal) {
    const k = `${p.supplier!.key}|${p.market}|${p.season}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  for (const [k, ps] of groups) {
    const [supKey, market, season] = k.split('|') as [string, Market, string];
    const sup = SUPPLIERS.find((s) => s.key === supKey)!;
    const launch = Math.min(...ps.map((p) => p.launched));
    const expected = launch - between(6, 14) * DAY;
    const delay = (sup.delay + gauss() * sup.sd) * DAY;
    const isNow = season.endsWith('26');
    const lines = ps.map((p) => {
      const seasonSold = sold.get(p.key) ?? 0;
      const factor = swimEg(p) ? 1.95 : p.season === 'AW25' && shortEg.has(p.key) ? 0.62 : 1.18;
      return { p, qty: Math.max(sup.moq, Math.round(((isNow ? Math.max(seasonSold, 1) * 2.2 : seasonSold) * factor) / sup.pack) * sup.pack) };
    });
    await makePo({ sup, market, lines, status: 'closed', created: expected - sup.lead * DAY - between(10, 30) * DAY, sent: expected - sup.lead * DAY, expected, received: expected + delay, fill: sup.fill, reason: `${season} season buy` });
  }
  // the reorder that came too late: Women'secret pyjamas, last November
  const lateLines = prods.filter((p) => shortEg.has(p.key)).map((p) => ({ p, qty: Math.round(((sold.get(p.key) ?? 40) * 0.45) / 6) * 6 }));
  const twSup = SUPPLIERS[0];
  await makePo({ sup: twSup, market: 'EG', lines: lateLines, status: 'closed', created: Date.parse('2025-11-02T09:00:00Z'), sent: Date.parse('2025-11-03T09:00:00Z'), expected: Date.parse('2025-11-30T09:00:00Z'), received: Date.parse('2025-12-10T11:00:00Z'), fill: 0.97, reason: 'Pyjamas sold out after White Friday' });

  // core replenishment, every quarter, sized to the quarter's sales
  const core = current.filter((p) => p.season === 'core' && p.supplier);
  const coreGroups = new Map<string, Prod[]>();
  for (const p of core) coreGroups.set(`${p.supplier!.key}|${p.market}`, [...(coreGroups.get(`${p.supplier!.key}|${p.market}`) ?? []), p]);
  for (const [k, ps] of coreGroups) {
    const [supKey, market] = k.split('|') as [string, Market];
    const sup = SUPPLIERS.find((s) => s.key === supKey)!;
    for (let q = 7; q >= 1; q--) {
      const expected = now - q * 91 * DAY + between(-10, 10) * DAY;
      const qWeeks = weekRange(weekOf(expected - 91 * DAY), weekOf(expected));
      const lines = ps.map((p) => ({ p, qty: Math.round((qWeeks.reduce((s, w) => s + (sold.get(`${p.key}|${w.slice(0, 7)}`) ?? 0) / 4.3, 0) * 1.05) / sup.pack) * sup.pack }));
      const delay = (sup.delay + gauss() * sup.sd) * DAY;
      await makePo({ sup, market, lines, status: 'closed', created: expected - sup.lead * DAY - between(3, 12) * DAY, sent: expected - sup.lead * DAY, expected, received: expected + delay, fill: sup.fill, reason: 'Quarterly replenishment' });
    }
  }

  // open today
  const hotWs = current.filter((p) => p.market === 'EG' && srcOf(p) === 'wsEg' && p.season === 'AW26' && p.category === 'nightwear').sort((a, b) => b.pop - a.pop);
  const s = (key: string) => SUPPLIERS.find((x) => x.key === key)!;
  const pickLines = (pool: Prod[], n: number, qty: [number, number]) => pool.slice(0, n).map((p) => ({ p, qty: Math.round(between(qty[0], qty[1]) / 6) * 6 }));
  const brandPool = (m: Market, brand: string) => current.filter((p) => p.market === m && sameBrand(p.item.brand, brand) && p.status === 'active').sort((a, b) => b.pop - a.pop);
  await makePo({ sup: s('tendam'), market: 'EG', lines: pickLines(hotWs.slice(2), 5, [30, 60]), status: 'confirmed', created: now - 30 * DAY, sent: now - 29 * DAY, expected: now + 9 * DAY, reason: 'AW26 top-up' });
  await makePo({ sup: s('lipsy'), market: 'EG', lines: pickLines(brandPool('EG', 'Lipsy London'), 6, [18, 36]), status: 'sent', created: now - 7 * DAY, sent: now - 6 * DAY, expected: now + 29 * DAY });
  await makePo({ sup: s('f21'), market: 'EG', lines: pickLines(brandPool('EG', 'Forever 21'), 12, [60, 140]), status: 'approval', created: now - 26 * HOUR, expected: now + 60 * DAY, reason: 'Holiday drop' });
  await makePo({ sup: s('maxmara'), market: 'EG', lines: pickLines(brandPool('EG', 'Marina Rinaldi'), 3, [6, 12]), status: 'draft', created: now - 3 * HOUR, expected: now + 49 * DAY, source: 'ai', reason: 'From the AI plan' });
  await makePo({ sup: s('etam'), market: 'KW', lines: pickLines(brandPool('KW', 'Etam'), 8, [24, 48]), status: 'confirmed', created: now - 44 * DAY, sent: now - 42 * DAY, expected: now + 20 * HOUR, reason: 'AW26 second drop' });
  await makePo({ sup: s('lver'), market: 'KW', lines: pickLines(brandPool('KW', 'La vie en rose'), 7, [24, 48]), status: 'confirmed', created: now - 66 * DAY, sent: now - 64 * DAY, expected: now - 4 * DAY, reason: 'AW26 nightwear' });
  await makePo({ sup: s('hunk'), market: 'KW', lines: pickLines(brandPool('KW', 'Hunkemoller'), 6, [24, 36]), status: 'partial', created: now - 40 * DAY, sent: now - 39 * DAY, expected: now - 1 * DAY, received: now - 20 * HOUR, partial: 0.7, reason: 'Lingerie replenishment' });
  await makePo({ sup: s('benetton'), market: 'KW', lines: pickLines(brandPool('KW', 'Benetton'), 14, [12, 30]), status: 'confirmed', created: now - 70 * DAY, sent: now - 68 * DAY, expected: now + 20 * DAY, reason: 'FW26 delivery' });
  await makePo({ sup: s('bebe'), market: 'KW', lines: pickLines(brandPool('KW', 'Bebe'), 5, [12, 24]), status: 'approved', created: now - 2 * DAY, expected: now + 58 * DAY });

  // the holiday pipeline: most of the range is already on order, as it would be by mid-October.
  // The planner should find the gaps (the AW26 hits, a few core styles), not re-buy the whole range.
  const pipe = new Map<string, Line[]>();
  for (const p of current) {
    if (!p.supplier || p.dead || p.season === 'SS26' || hash(p.key, 51) > 0.78) continue;
    const hot = p.season === 'AW26' && ['nightwear', 'knitwear', 'outerwear'].includes(p.category) && (popRank.get(p.key) ?? 1) < 0.25;
    if (hot) continue;
    const horizon = Math.ceil(p.supplier.lead / 7) + 3;
    let demand = 0;
    for (const l of p.locs) for (let i = 0; i < horizon; i++) demand += lambda(p, l, addWeeks(thisWeek, i));
    const have = p.locs.reduce((s, l) => s + (onHandOf.get(`${p.id}@${l.id}`) ?? 0), 0);
    const qty = Math.round(Math.max(0, demand * 1.3 - have) / p.supplier.pack) * p.supplier.pack;
    if (qty < p.supplier.moq) continue;
    const k = `${p.supplier.key}|${p.market}`;
    pipe.set(k, [...(pipe.get(k) ?? []), { p, qty }]);
  }
  for (const [k, lines] of pipe) {
    const [supKey, market] = k.split('|') as [string, Market];
    const sup = SUPPLIERS.find((x) => x.key === supKey)!;
    const sent = now - between(14, Math.max(16, sup.lead - 5)) * DAY;
    await makePo({ sup, market, lines, status: chance(0.8) ? 'confirmed' : 'sent', created: sent - between(1, 4) * DAY, sent, expected: sent + sup.lead * DAY, reason: 'Holiday buy' });
  }

  // ── transfers between the warehouse and the shops ──
  log('Moving stock between shops…');
  let trSeq = 0;
  const kwStores = locs.filter((l) => l.country === 'KW' && l.kind === 'store');
  const egStores = locs.filter((l) => l.country === 'EG' && l.kind === 'store');
  const makeTransfer = async (from: Loc, to: Loc, status: string, created: number, n: number) => {
    const pool = current.filter((p) => p.locs.includes(from) && p.locs.includes(to) && (onHandOf.get(`${p.id}@${from.id}`) ?? 0) > 3);
    if (!pool.length) return null;
    const chosen = pool.sort(() => rnd() - 0.5).slice(0, n);
    const creator = from.country === 'EG' ? u('nour') : u('dana');
    const [t] = await db
      .insert(schema.transfers)
      .values({ number: `TR-${String(++trSeq).padStart(4, '0')}`, fromId: from.id, toId: to.id, status, units: 0, reason: from.kind === 'warehouse' ? `${to.name} running short` : `Not selling at ${from.name}`, source: chance(0.7) ? 'ai' : 'manual', createdBy: creator?.id ?? null, createdByName: creator?.name ?? 'Planner', createdAt: new Date(created), shippedAt: status === 'in_transit' || status === 'received' ? new Date(created + between(4, 20) * HOUR) : null, receivedAt: status === 'received' ? new Date(created + between(24, 60) * HOUR) : null })
      .returning();
    let units = 0;
    for (const p of chosen) {
      const v = pick(vByProduct.get(p.id!) ?? []);
      if (!v) continue;
      const q = Math.round(between(2, 6));
      units += q;
      await db.insert(schema.transferLines).values({ transferId: t.id, productId: p.id!, variantId: v.id, qty: q, received: status === 'received' ? q : 0 });
      if (status !== 'proposed' && status !== 'picking') moves.push({ at: t.shippedAt!, variantId: v.id, productId: p.id!, locationId: from.id, qty: -q, kind: 'transfer_out', refType: 'transfer', refId: t.id, actorName: 'Warehouse', note: t.number });
      if (status === 'received') moves.push({ at: t.receivedAt!, variantId: v.id, productId: p.id!, locationId: to.id, qty: q, kind: 'transfer_in', refType: 'transfer', refId: t.id, actorName: from.country === 'KW' ? 'Dalal Al-Kandari' : 'Sherif Adel', note: t.number });
    }
    await db.update(schema.transfers).set({ units }).where(sql`id = ${t.id}`);
    return { ...t, units };
  };
  const kwWh = locs.find((l) => l.id === 'dh-kuwait')!;
  const egWh = locs.find((l) => l.id === 'fig-cairo')!;
  for (let i = 0; i < 9; i++) {
    const kw = i % 3 !== 0;
    const stores = kw ? kwStores : egStores;
    const to = pick(stores);
    const from = chance(0.5) ? (kw ? kwWh : egWh) : pick(stores.filter((x) => x !== to && x.brands.join() === to.brands.join()).concat(kw ? [kwWh] : [egWh]));
    await makeTransfer(from, to, 'received', now - between(2, 28) * DAY, Math.round(between(3, 8)));
  }
  const gate = kwStores.find((l) => l.id === 'etam-gate')!;
  const avenues = kwStores.find((l) => l.id === 'etam-avenues')!;
  const inTransit = await makeTransfer(gate, avenues, 'in_transit', now - 30 * HOUR, 5);
  const picking = await makeTransfer(kwWh, kwStores.find((l) => l.id === 'lavieenrose-360')!, 'picking', now - 5 * HOUR, 4);
  const toPick = await makeTransfer(egWh, egStores.find((l) => l.id === 'fig-moe')!, 'proposed', now - 2 * HOUR, 6);

  // ── what the websites took off the shelf this month, and what the shops sold lately ──
  log('Writing the stock ledger…');
  const kwIds = Object.values(CHANNEL).filter((c) => c.country === 'KW').map((c) => c.id);
  await db.execute(sql`
    insert into stock_moves (at, variant_id, product_id, location_id, qty, kind, ref_type, ref_id, channel_id, actor_name, note)
    select coalesce(o.packed_at, o.shipped_at, o.updated_at), v.id, v.product_id,
      case when o.channel_id in (${sql.join(kwIds.map((c) => sql`${c}`), sql`, `)}) then 'dh-kuwait' else 'fig-cairo' end,
      -i.quantity, 'sale', 'order', o.id, o.channel_id, 'Warehouse', o.number || ' left the warehouse'
    from orders o join order_items i on i.order_id = o.id
    join variants v on v.sku = i.sku
    join products p on p.id = v.product_id and p.market = case when o.channel_id in (${sql.join(kwIds.map((c) => sql`${c}`), sql`, `)}) then 'KW' else 'EG' end
    where o.source = 'demo' and o.stage in ('packed','shipped','delivering','delivered','settled','rto','rto_closed')`);
  // shop tills, a line per style a week for the last eight weeks
  const tills = await db.execute<{ week: string; product_id: string; location_id: string; units: number }>(sql`
    select sw.week::text as week, sw.product_id, sw.location_id, sw.units from sales_weekly sw join locations l on l.id = sw.location_id
    where l.kind = 'store' and sw.week >= ${addWeeks(thisWeek, -8)} and sw.units > 0`);
  const mixOf = new Map(prods.map((p) => [p.id!, p.mix]));
  for (const r of tills.rows) {
    const vars = vByProduct.get(r.product_id) ?? [];
    if (!vars.length) continue;
    // the till books by size; spread the week's pieces over the sizes by the curve
    const mix = mixOf.get(r.product_id) ?? {};
    const w = vars.map((v) => mix[v.size ?? ''] ?? 1 / vars.length);
    const wt = w.reduce((a, b) => a + b, 0) || 1;
    let left = r.units;
    const at = new Date(Math.min(now - 2 * HOUR, keyToTime(addDays(r.week, 6)) + 21 * HOUR));
    vars.forEach((v, i) => {
      const q = i === vars.length - 1 ? left : Math.min(left, Math.round((r.units * w[i]) / wt));
      left -= q;
      if (q > 0) moves.push({ at, variantId: v.id, productId: r.product_id, locationId: r.location_id, qty: -q, kind: 'sale', refType: 'pos', channelId: 'store', actorName: 'Lucida POS', note: `Till sales, week of ${r.week}` });
    });
  }
  for (let i = 0; i < moves.length; i += 1500) await db.insert(schema.stockMoves).values(moves.slice(i, i + 1500));

  // ── a month of the team's work ──
  log('Writing a month of the team’s work…');
  type Person = { u: (typeof users)[number]; kinds: TaskKind[]; util: number; pace: number };
  const plan: { email: string; kinds: TaskKind[]; util: number; pace: number }[] = [
    { email: 'joel', kinds: ['putaway', 'receive', 'replenish', 'cycle_count', 'quality_check'], util: 0.86, pace: 1.22 },
    { email: 'ramesh', kinds: ['transfer_pick', 'putaway', 'cycle_count', 'replenish'], util: 0.79, pace: 1.0 },
    { email: 'mahmoud', kinds: ['putaway', 'cycle_count', 'replenish', 'relabel'], util: 0.56, pace: 0.78 },
    { email: 'fatma', kinds: ['receive', 'quality_check', 'putaway'], util: 0.42, pace: 1.12 },
    { email: 'omar', kinds: ['receive', 'quality_check'], util: 0.38, pace: 1.08 },
    { email: 'karim', kinds: ['transfer_pick', 'replenish'], util: 0.36, pace: 1.02 },
    { email: 'dalal', kinds: ['transfer_receive', 'relabel', 'cycle_count'], util: 0.84, pace: 0.96 },
    { email: 'sherif', kinds: ['transfer_receive', 'relabel', 'cycle_count'], util: 0.7, pace: 1.0 },
    { email: 'tarek', kinds: ['supplier_followup', 'po_review'], util: 0.68, pace: 0.92 },
    { email: 'noura', kinds: ['supplier_followup', 'po_review'], util: 0.81, pace: 1.15 },
    { email: 'dana', kinds: ['po_review'], util: 0.55, pace: 1.0 },
    { email: 'maya', kinds: ['merch_setup'], util: 0.62, pace: 1.05 },
  ];
  const team: Person[] = plan.map((t) => ({ ...t, u: u(t.email)! })).filter((t) => t.u && t.u.shiftStart != null);
  const unitsFor = (k: TaskKind) => (k === 'receive' ? Math.round(between(80, 420)) : k === 'putaway' ? Math.round(between(40, 260)) : k === 'transfer_pick' || k === 'transfer_receive' ? Math.round(between(12, 60)) : k === 'cycle_count' ? Math.round(between(60, 300)) : k === 'relabel' ? Math.round(between(10, 50)) : k === 'quality_check' ? Math.round(between(20, 80)) : k === 'replenish' ? Math.round(between(30, 120)) : k === 'po_review' ? Math.round(between(100, 900)) : 0);
  const TITLE: Record<TaskKind, (n: number, l: string) => string> = {
    receive: (n) => `Receive ${n} pieces`,
    putaway: (n) => `Put away ${n} pieces`,
    transfer_pick: (n, l) => `Pick ${n} pieces for ${l}`, // l is the shop it is going to
    transfer_receive: (n, l) => `Receive ${n} pieces at ${l}`,
    cycle_count: (_n, l) => `Count bay ${'ABCDEFGH'[Math.floor(rnd() * 8)]}-${String(1 + Math.floor(rnd() * 24)).padStart(2, '0')}${l ? ` · ${l}` : ''}`,
    relabel: (n, l) => `Re-ticket ${n} pieces at ${l}`,
    quality_check: (n) => `Quality check ${n} pieces`,
    replenish: (n) => `Replenish pick face: ${n} pieces`,
    supplier_followup: () => pick(['Chase ship date with supplier', 'Confirm quantities on the open order', 'Ask for proof of dispatch', 'Agree a new delivery date']),
    po_review: (n) => `Review purchase order lines (${n} pieces)`,
    merch_setup: () => pick(['Check the cross-sell row on the website', 'Swap images on the pop-up', 'Review placement results']),
  };
  const taskRows: (typeof schema.tasks.$inferInsert)[] = [];
  const actRows: (typeof schema.activity.$inferInsert)[] = [];
  let tSeq = 0;
  const OFFSET = 3 * HOUR;
  const dayStart = (t: number) => t - ((t + OFFSET) % DAY);
  for (const person of team) {
    const pu = person.u;
    const storeLocs = pu.locationId ? [locs.find((l) => l.id === pu.locationId)!] : (pu.channels.some((c) => kwIds.includes(c)) ? kwStores : egStores);
    for (let d = 30; d >= 0; d--) {
      const day = dayStart(now - d * DAY);
      const dow = new Date(day + OFFSET).getUTCDay();
      if (pu.restDays.includes(dow)) continue;
      if (chance(0.04) && d > 0) continue; // a day off now and then
      const from = day + pu.shiftStart! * MIN;
      const to = day + pu.shiftEnd! * MIN;
      let t = from + between(4, 25) * MIN;
      while (t < to - 25 * MIN && t < now) {
        const kind = pick(person.kinds);
        const units = unitsFor(kind);
        const est = estimateMinutes(kind, units);
        const spent = Math.max(3, Math.round((est / person.pace) * Math.exp(gauss() * 0.22)));
        const end = t + spent * MIN;
        const loc = pick(storeLocs);
        const doing = end > now;
        const shop = pick(pu.channels.some((c) => kwIds.includes(c)) ? kwStores : egStores);
        const id = crypto.randomUUID();
        const title = TITLE[kind](units, kind === 'transfer_pick' ? shop.name : loc?.name ?? '');
        const area = ['supplier_followup', 'po_review'].includes(kind) ? 'procurement' : kind === 'merch_setup' ? 'merch' : 'warehouse';
        taskRows.push({
          id,
          number: `T-${String(++tSeq).padStart(4, '0')}`,
          kind,
          area,
          title,
          locationId: ['supplier_followup', 'po_review', 'merch_setup'].includes(kind) ? null : loc?.id ?? null,
          assigneeId: pu.id,
          status: doing ? 'doing' : 'done',
          priority: chance(0.15) ? 2 : 3,
          dueAt: new Date(to),
          startedAt: new Date(t),
          doneAt: doing ? null : new Date(end),
          estMinutes: est,
          spentMinutes: doing ? null : spent,
          units,
          source: chance(0.62) ? 'ai' : 'manual',
          createdBy: null,
          createdByName: chance(0.62) ? 'AI planner' : 'Hala Barakat',
          createdAt: new Date(t - between(20, 600) * MIN),
        });
        if (!doing) actRows.push({ at: new Date(end), actorId: pu.id, actorName: pu.name, area, kind: 'task_done', refType: 'task', refId: id, message: title, data: { units } });
        if (doing) break;
        // the gap before the next job: what makes the difference between 56% and 86%
        const gap = -Math.log(Math.max(1e-6, rnd())) * spent * (1 / person.util - 1);
        t = end + Math.min(gap, 140) * MIN;
      }
    }
  }
  // waiting work for tomorrow, some of it overdue
  const queue: { email: string; kind: TaskKind; due: number; priority: number }[] = [
    { email: 'mahmoud', kind: 'putaway', due: now - 20 * HOUR, priority: 2 },
    { email: 'mahmoud', kind: 'cycle_count', due: now - 4 * HOUR, priority: 3 },
    { email: 'joel', kind: 'replenish', due: now + 16 * HOUR, priority: 3 },
    { email: 'dalal', kind: 'relabel', due: now + 20 * HOUR, priority: 3 },
    { email: 'sherif', kind: 'cycle_count', due: now + 26 * HOUR, priority: 4 },
    { email: 'tarek', kind: 'po_review', due: now - 2 * HOUR, priority: 2 },
  ];
  for (const q of queue) {
    const pu = u(q.email);
    if (!pu) continue;
    const units = unitsFor(q.kind);
    const loc = pu.locationId ?? (pu.channels.some((c) => kwIds.includes(c)) ? pick(kwStores).id : pick(egStores).id);
    taskRows.push({ number: `T-${String(++tSeq).padStart(4, '0')}`, kind: q.kind, area: q.kind === 'po_review' ? 'procurement' : 'warehouse', title: TITLE[q.kind](units, locs.find((l) => l.id === loc)?.name ?? ''), locationId: q.kind === 'po_review' ? null : loc, assigneeId: pu.id, status: 'open', priority: q.priority, dueAt: new Date(q.due), estMinutes: estimateMinutes(q.kind, units), units, source: 'ai', createdByName: 'AI planner', createdAt: new Date(q.due - 30 * HOUR) });
  }
  // the open transfers' jobs
  if (picking) taskRows.push({ number: `T-${String(++tSeq).padStart(4, '0')}`, kind: 'transfer_pick', area: 'warehouse', title: `Pick ${picking.number}: ${picking.units} pieces for La Vie en Rose · 360 Mall`, locationId: 'dh-kuwait', assigneeId: u('ramesh')?.id ?? null, status: 'open', priority: 3, dueAt: new Date(now + 16 * HOUR), estMinutes: estimateMinutes('transfer_pick', picking.units), units: picking.units, refType: 'transfer', refId: picking.id, source: 'ai', createdByName: 'Dana Al-Mutairi', createdAt: new Date(now - 5 * HOUR) });
  if (toPick) taskRows.push({ number: `T-${String(++tSeq).padStart(4, '0')}`, kind: 'transfer_pick', area: 'warehouse', title: `Pick ${toPick.number}: ${toPick.units} pieces for FIG · Mall of Egypt`, locationId: 'fig-cairo', assigneeId: u('karim')?.id ?? null, status: 'open', priority: 3, dueAt: new Date(now + 20 * HOUR), estMinutes: estimateMinutes('transfer_pick', toPick.units), units: toPick.units, refType: 'transfer', refId: toPick.id, source: 'ai', createdByName: 'Nour Hassan', createdAt: new Date(now - 2 * HOUR) });
  if (inTransit) taskRows.push({ number: `T-${String(++tSeq).padStart(4, '0')}`, kind: 'transfer_receive', area: 'warehouse', title: `Receive ${inTransit.number}: ${inTransit.units} pieces at Etam · Avenues Mall`, locationId: 'etam-avenues', assigneeId: u('dalal')?.id ?? null, status: 'open', priority: 3, dueAt: new Date(now + 14 * HOUR), estMinutes: estimateMinutes('transfer_receive', inTransit.units), units: inTransit.units, refType: 'transfer', refId: inTransit.id, source: 'system', createdByName: 'Ramesh Nair', createdAt: new Date(now - 26 * HOUR) });
  for (let i = 0; i < taskRows.length; i += 1000) await db.insert(schema.tasks).values(taskRows.slice(i, i + 1000));
  for (let i = 0; i < actRows.length; i += 1500) await db.insert(schema.activity).values(actRows.slice(i, i + 1500));
  log(`  ${taskRows.length.toLocaleString('en')} tasks`);

  // ── the AI's last month: what it proposed and what people did with it ──
  log('Replaying the planner’s last month…');
  const deciders: Record<string, (typeof users)[number] | undefined> = { procurement: u('noura'), stock: u('dana'), warehouse: u('fatma'), merch: u('maya') };
  const histRows: (typeof schema.recommendations.$inferInsert)[] = [];
  const kinds: { kind: string; area: string; title: (p: Prod) => string; impact: () => number }[] = [
    { kind: 'reorder', area: 'procurement', title: (p) => `Reorder ${p.item.title.replace(/&amp;/g, '&')}`, impact: () => Math.round(between(8_000, 140_000)) * 100 },
    { kind: 'transfer', area: 'stock', title: (p) => `Move ${Math.round(between(12, 60))} pieces of ${p.item.brand} between shops`, impact: () => Math.round(between(4_000, 40_000)) * 100 },
    { kind: 'markdown', area: 'stock', title: (p) => `Mark down ${p.item.title.replace(/&amp;/g, '&')} by 30%`, impact: () => Math.round(between(5_000, 60_000)) * 100 },
    { kind: 'cross_sell', area: 'merch', title: (p) => `Show ${p.item.title.replace(/&amp;/g, '&')} on best-selling product pages`, impact: () => Math.round(between(3_000, 25_000)) * 100 },
    { kind: 'count', area: 'warehouse', title: () => `Count ${Math.round(between(10, 40))} styles at ${pick(locs).name}`, impact: () => 0 },
  ];
  for (let i = 0; i < 74; i++) {
    const k = pick(kinds);
    const p = pick(current);
    const created = now - between(1.5, 30) * DAY;
    const fate = rnd();
    const status = fate < 0.58 ? 'done' : fate < 0.74 ? 'dismissed' : fate < 0.8 ? 'accepted' : 'expired';
    const decider = deciders[k.area];
    const latency = (k.area === 'procurement' ? between(0.4, 9) : k.area === 'merch' ? between(2, 30) : between(1, 20)) * HOUR;
    histRows.push({ key: `history:${i}`, kind: k.kind, area: k.area, status, market: p.market, title: k.title(p), body: 'From an earlier pass of the planner.', impact: k.impact(), confidence: Math.round(between(55, 90)), priority: 3, productId: p.id, payload: {}, createdAt: new Date(created), updatedAt: new Date(created + latency), decidedBy: status === 'expired' ? null : decider?.id ?? null, decidedByName: status === 'expired' ? null : decider?.name ?? null, decidedAt: status === 'expired' ? null : new Date(Math.min(now - HOUR, created + latency)), resultRef: status === 'dismissed' ? pick(['Supplier out of this style', 'Already agreed by phone', 'Brand asked us not to discount', 'Counted last week']) : null });
  }
  await db.insert(schema.recommendations).values(histRows);

  // ── website placements already running ──
  log('Placing last month’s cross-sells…');
  const egNight = current.filter((p) => p.market === 'EG' && p.category === 'nightwear' && p.channels.includes('ws-eg') && !p.dead).sort((a, b) => b.pop - a.pop);
  const egAcc = current.filter((p) => p.market === 'EG' && (p.category === 'accessories' || p.category === 'homewear') && p.channels.length).sort((a, b) => a.pop - b.pop);
  const kwEtamBra = current.filter((p) => p.market === 'KW' && sameBrand(p.item.brand, 'Etam') && p.category === 'lingerie').sort((a, b) => b.pop - a.pop);
  const kwEtamSleep = current.filter((p) => p.market === 'KW' && sameBrand(p.item.brand, 'Etam') && p.category === 'nightwear').sort((a, b) => a.pop - b.pop);
  const kwSwim = current.filter((p) => p.market === 'KW' && p.category === 'swimwear' && p.channels.includes('ws-kw')).sort((a, b) => b.pop - a.pop);
  const egDress = current.filter((p) => p.market === 'EG' && p.category === 'dresses' && p.channels.includes('fig-web')).sort((a, b) => b.pop - a.pop);
  const egBags = current.filter((p) => p.market === 'EG' && p.category === 'bags' && p.channels.includes('fig-web')).sort((a, b) => a.pop - b.pop);
  const placementsDef = [
    { kind: 'cross_sell', status: 'live', market: 'EG', channels: ['ws-eg'], anchors: egNight.slice(0, 3), items: egAcc.slice(0, 2), headline: 'Complete the look', headlineAr: 'أكملي إطلالتك', days: 18, ctr: 0.048 },
    { kind: 'bundle', status: 'live', market: 'KW', channels: ['labesny-web', 'labesny-app'], anchors: kwEtamBra.slice(0, 2), items: kwEtamSleep.slice(0, 1), headline: 'Make it a set', headlineAr: 'اجعليها طقماً', days: 11, ctr: 0.061 },
    { kind: 'cross_sell', status: 'live', market: 'EG', channels: ['fig-web', 'fig-app'], anchors: egDress.slice(0, 4), items: egBags.slice(0, 2), headline: 'The bag for it', headlineAr: 'الحقيبة المناسبة', days: 6, ctr: 0.039 },
    { kind: 'popup', status: 'paused', market: 'KW', channels: ['ws-kw'], anchors: [], items: kwSwim.slice(0, 3), headline: 'The last of the summer', headlineAr: 'آخر قطع الصيف', offer: '30% off swimwear', days: 9, ctr: 0.031 },
    { kind: 'popup', status: 'ended', market: 'EG', channels: ['fig-web'], anchors: [], items: egDress.slice(5, 8), headline: 'Eid edit', headlineAr: 'تشكيلة العيد', days: 14, ctr: 0.035, endedDaysAgo: 120 },
  ];
  let wp = 0;
  const maya = u('maya');
  for (const d of placementsDef) {
    if (!d.items.length) continue;
    const started = now - (d.days + (d.endedDaysAgo ?? 0)) * DAY;
    const [pl] = await db
      .insert(schema.placements)
      .values({ number: `WP-${String(++wp).padStart(3, '0')}`, kind: d.kind, status: d.status, market: d.market, channels: d.channels, anchors: d.anchors.map((p) => p.id!), items: d.items.map((p) => p.id!), headline: d.headline, headlineAr: d.headlineAr, offer: d.offer ?? null, startsAt: new Date(started), endsAt: d.endedDaysAgo ? new Date(now - d.endedDaysAgo * DAY) : null, createdBy: maya?.id ?? null, createdByName: 'AI planner', approvedBy: maya?.id ?? null, approvedByName: maya?.name ?? null, approvedAt: new Date(started), createdAt: new Date(started - 5 * HOUR) })
      .returning();
    const daily: (typeof schema.placementDaily.$inferInsert)[] = [];
    const runDays = d.status === 'paused' ? d.days - 3 : d.days;
    for (let i = 0; i < runDays; i++) {
      const t = started + i * DAY;
      const impressions = Math.round(between(260, 900) * (d.kind === 'popup' ? 2.2 : 1) * (d.market === 'KW' ? 0.6 : 1));
      const clicks = poisson(impressions * d.ctr);
      const adds = poisson(clicks * 0.26);
      const orders = poisson(adds * 0.5);
      const price = d.items[0].price;
      daily.push({ placementId: pl.id, day: new Date(t + OFFSET).toISOString().slice(0, 10), impressions, clicks, adds, orders, revenue: Math.round(inEgp(orders * price, d.items[0].currency) * 100 * (d.offer ? 0.7 : 1)) });
    }
    if (daily.length) await db.insert(schema.placementDaily).values(daily);
  }

  catalogueChanged();
  invalidateFacts();
  log('The AI planner is reading the range…');
  const run = await runPlanner({ quiet: true });
  log(`  ${run.recs} proposals (${Object.entries(run.byKind).map(([k, n]) => `${n} ${k}`).join(', ')}), ${run.tasks} routine tasks, in ${Math.round(run.ms / 100) / 10}s`);
  return { products: current.length, weeks: written };
}
