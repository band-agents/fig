import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import type { Principal } from '../../domain/perms';
import { CATEGORY_LABEL, type Category } from '../../domain/stock/categories';
import type { Velocity } from '../../domain/stock/classify';
import { remember } from '../../remember';
import { factsFor, getFacts, type ProductFacts } from '../facts';
import { marketsFor, sees } from './common';

// Inventory as the warehouse reads it (Dan, 27 Oct: "make it look like warehouse inventory, great and
// comprehensive"): every SKU and barcode, how many pieces in which place and bin, which sizes ran out,
// what is coming, what it is worth. Three ways to read it: by style with its size run, by SKU, and as a
// style × location matrix.

export type StockMode = 'styles' | 'skus' | 'matrix';
export type StockFilters = { q?: string; market?: string; brand?: string; category?: string; season?: string; location?: string; status?: string; mode?: string; sort?: string; page?: number; all?: boolean };

export const STOCK_STATUSES: { key: string; label: string; hint: string; tone: string }[] = [
  { key: '', label: 'All', hint: 'Every live style', tone: 'neutral' },
  { key: 'in', label: 'In stock', hint: 'Pieces on hand', tone: 'success' },
  { key: 'broken', label: 'Sizes missing', hint: 'Some sizes sold out while others are on hand', tone: 'warning' },
  { key: 'low', label: 'Running low', hint: 'Under three weeks left at the pace it sells', tone: 'attention' },
  { key: 'out', label: 'Out of stock', hint: 'No pieces anywhere you can see', tone: 'critical' },
  { key: 'over', label: 'Overstock', hint: 'Over half a year of cover', tone: 'info' },
  { key: 'dead', label: 'Not selling', hint: 'Pieces on hand and no sale in the last weeks', tone: 'neutral' },
  { key: 'new', label: 'New in', hint: 'Live for under six weeks', tone: 'magic' },
];

type SkuCounts = { skus: number; inStock: number; low: number };

/** Per style: how many sizes it has, how many are on hand, how many are down to one or two pieces. */
function skuCounts(location: string | undefined) {
  return remember(`stockroom:skus:${location ?? '*'}`, 60_000, async () => {
    const db = await getDb();
    const r = await db.execute<{ product_id: string; skus: number; in_stock: number; low: number }>(sql`
      select v.product_id, count(*)::int as skus,
        count(*) filter (where coalesce(s.q, 0) > 0)::int as in_stock,
        count(*) filter (where coalesce(s.q, 0) between 1 and 2)::int as low
      from variants v
      left join (select variant_id, sum(on_hand) as q from stock_levels ${location ? sql`where location_id = ${location}` : sql``} group by 1) s on s.variant_id = v.id
      group by 1`);
    return new Map<string, SkuCounts>(r.rows.map((x) => [x.product_id, { skus: x.skus, inStock: x.in_stock, low: x.low }]));
  });
}

const qtyAt = (x: ProductFacts, location?: string) => (location ? (x.byLocation[location]?.onHand ?? 0) : x.onHand);

function statusOf(x: ProductFacts, c: SkuCounts | undefined, location?: string) {
  const on = qtyAt(x, location);
  const set = new Set<string>();
  if (on > 0) set.add('in');
  else set.add('out');
  if (on > 0 && c && c.inStock < c.skus && c.inStock > 0) set.add('broken');
  if (on > 0 && x.rate > 0.3 && x.cover < 3) set.add('low');
  if (on > 0 && x.velocity === 'dead') set.add('dead');
  else if (on > 0 && x.cover > 26) set.add('over');
  if (x.velocity === 'new') set.add('new');
  return set;
}

/** The one word the row shows: the most urgent thing about it. */
function headline(s: Set<string>) {
  for (const k of ['out', 'broken', 'low', 'dead', 'over', 'new']) if (s.has(k)) return k;
  return 'in';
}

export async function stockroom(p: Principal, f: StockFilters) {
  const db = await getDb();
  const facts = factsFor(await getFacts(), p);
  const s = sees(p);
  const markets = marketsFor(p);
  const mode: StockMode = f.mode === 'skus' || f.mode === 'matrix' ? f.mode : 'styles';
  const counts = await skuCounts(f.location);
  const base = facts.products.filter((x) => markets.includes(x.market) && (!f.market || x.market === f.market));

  // a barcode or a SKU typed in the search finds its style
  const q = f.q?.trim().toLowerCase();
  let byCode: Set<string> | null = null;
  if (q && q.length >= 4) {
    const hit = await db.execute<{ product_id: string }>(sql`select distinct product_id from variants where lower(barcode) = ${q} or lower(sku) like ${`${q}%`} limit 200`);
    if (hit.rows.length) byCode = new Set(hit.rows.map((r) => r.product_id));
  }
  const status = new Map(base.map((x) => [x.id, statusOf(x, counts.get(x.id), f.location)]));
  const scoped = base.filter(
    (x) =>
      (!f.brand || x.brand === f.brand) &&
      (!f.category || x.category === f.category) &&
      (!f.season || x.season === f.season) &&
      (!f.location || (x.byLocation[f.location]?.onHand ?? 0) > 0 || f.status === 'out') &&
      (!q || byCode?.has(x.id) || x.title.toLowerCase().includes(q) || x.styleCode.toLowerCase().includes(q) || x.brand.toLowerCase().includes(q)),
  );
  const statusCounts = Object.fromEntries(STOCK_STATUSES.map((st) => [st.key, st.key ? scoped.filter((x) => status.get(x.id)!.has(st.key)).length : scoped.length]));
  let rows = f.status ? scoped.filter((x) => status.get(x.id)!.has(f.status!)) : scoped;

  const sort = f.sort ?? (f.status === 'low' ? 'cover' : f.status === 'broken' ? 'missing' : 'value');
  const missing = (x: ProductFacts) => {
    const c = counts.get(x.id);
    return c ? c.skus - c.inStock : 0;
  };
  const by: Record<string, (a: ProductFacts, b: ProductFacts) => number> = {
    value: (a, b) => b.valueRetailEgp - a.valueRetailEgp,
    units: (a, b) => qtyAt(b, f.location) - qtyAt(a, f.location),
    cover: (a, b) => (Number.isFinite(a.cover) ? a.cover : 1e9) - (Number.isFinite(b.cover) ? b.cover : 1e9),
    rate: (a, b) => b.rate - a.rate,
    missing: (a, b) => missing(b) - missing(a) || b.rate - a.rate,
    code: (a, b) => a.styleCode.localeCompare(b.styleCode),
    name: (a, b) => a.title.localeCompare(b.title),
  };
  rows = [...rows].sort(by[sort] ?? by.value);

  // the numbers across everything the filters hold
  const sum = (fn: (x: ProductFacts) => number) => rows.reduce((a, x) => a + fn(x), 0);
  const skuTotal = sum((x) => counts.get(x.id)?.skus ?? 0);
  const skuIn = sum((x) => counts.get(x.id)?.inStock ?? 0);
  const totals = {
    styles: rows.length,
    skus: skuTotal,
    skusIn: skuIn,
    skusOut: skuTotal - skuIn,
    skusLow: sum((x) => counts.get(x.id)?.low ?? 0),
    units: sum((x) => Math.max(0, qtyAt(x, f.location))),
    retail: s.money ? sum((x) => (f.location ? Math.round(x.valueRetailEgp * (qtyAt(x, f.location) / Math.max(1, x.onHand))) : x.valueRetailEgp)) : null,
    cost: s.cost ? sum((x) => (f.location ? Math.round(x.valueCostEgp * (qtyAt(x, f.location) / Math.max(1, x.onHand))) : x.valueCostEgp)) : null,
    incoming: sum((x) => x.onOrder + x.inTransit),
  };

  // every place that holds stock, for the cards across the top (the market's whole range, not the filters)
  const locRows = await db.execute<{ id: string; name: string; kind: string; city: string | null; area: string | null; country: string }>(sql`select id, name, kind, city, area, country from locations where active`);
  const locName = new Map(locRows.rows.map((l) => [l.id, l]));
  const perLoc = new Map<string, { units: number; styles: number; retail: number }>();
  for (const x of base) {
    for (const [id, l] of Object.entries(x.byLocation)) {
      if (l.onHand <= 0) continue;
      const o = perLoc.get(id) ?? { units: 0, styles: 0, retail: 0 };
      o.units += l.onHand;
      o.styles += 1;
      o.retail += x.onHand ? Math.round(x.valueRetailEgp * (l.onHand / x.onHand)) : 0;
      perLoc.set(id, o);
    }
  }
  const locations = [...perLoc.entries()]
    .map(([id, o]) => ({ id, name: locName.get(id)?.name ?? id, kind: locName.get(id)?.kind ?? 'warehouse', place: [locName.get(id)?.area, locName.get(id)?.city].filter(Boolean).join(', '), units: o.units, styles: o.styles, retail: s.money ? o.retail : null }))
    .sort((a, b) => b.units - a.units);

  const brands = [...new Set(base.map((x) => x.brand))].sort();
  const categories = [...new Set(base.map((x) => x.category))].sort().map((c) => ({ id: c, label: CATEGORY_LABEL[c as Category] }));
  const seasons = [...new Set(base.map((x) => x.season))].filter((x) => x && x !== 'core').sort().reverse();

  const per = mode === 'skus' ? 100 : 50;
  const page = Math.max(1, f.page ?? 1);
  const recFor = new Map((await db.execute<{ product_id: string; kind: string }>(sql`select product_id, kind from recommendations where status = 'open' and product_id is not null order by priority`)).rows.map((r) => [r.product_id, r.kind]));

  const styleOf = (x: ProductFacts): StyleRow => {
    const st = status.get(x.id)!;
    const c = counts.get(x.id);
    return {
      id: x.id,
      title: x.title,
      brand: x.brand,
      styleCode: x.styleCode,
      image: x.image,
      market: x.market,
      season: x.season,
      category: CATEGORY_LABEL[x.category],
      currency: x.currency,
      price: s.money ? x.price : null,
      onHand: qtyAt(x, f.location),
      warehouse: x.warehouseOnHand,
      shops: x.onHand - x.warehouseOnHand,
      incoming: x.onOrder + x.inTransit,
      skus: c?.skus ?? 0,
      skusIn: c?.inStock ?? 0,
      rate: x.rate,
      cover: x.cover,
      weeksSinceSale: x.weeksSinceSale,
      velocity: x.velocity as Velocity,
      status: headline(st),
      retail: s.money ? (f.location ? Math.round(x.valueRetailEgp * (qtyAt(x, f.location) / Math.max(1, x.onHand))) : x.valueRetailEgp) : null,
      next: recFor.get(x.id) ?? null,
      byLocation: Object.fromEntries(Object.entries(x.byLocation).map(([k, v]) => [k, v.onHand])),
    };
  };

  // the sizes of the styles on screen (or every size, for an export)
  const sizesFor = async (ids: string[]) => {
    const out = new Map<string, SizeRow[]>();
    // in slices, so an export of every style stays under Postgres's limit on parameters
    for (let i = 0; i < ids.length; i += 2000) for (const [k, v] of await sizesOf(ids.slice(i, i + 2000))) out.set(k, v);
    return out;
  };
  const sizesOf = async (ids: string[]) => {
    const r = await db.execute<{ id: string; product_id: string; size: string | null; size_idx: number; barcode: string | null; sku: string; qty: number; bins: string | null; counted: string | null; places: Record<string, number> | null }>(sql`
      select v.id, v.product_id, v.size, v.size_idx, v.barcode, v.sku,
        coalesce(sum(sl.on_hand) ${f.location ? sql`filter (where sl.location_id = ${f.location})` : sql``}, 0)::int as qty,
        string_agg(distinct sl.bin, ', ') filter (where sl.bin is not null and sl.bin <> '') as bins,
        max(sl.counted_at)::text as counted,
        jsonb_object_agg(sl.location_id, sl.on_hand) filter (where sl.location_id is not null and sl.on_hand <> 0) as places
      from variants v left join stock_levels sl on sl.variant_id = v.id
      where v.product_id in (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})
      group by v.id order by v.product_id, v.size_idx, v.size`);
    const out = new Map<string, SizeRow[]>();
    for (const x of r.rows) {
      const list = out.get(x.product_id) ?? [];
      list.push({ id: x.id, size: x.size || 'One size', barcode: x.barcode, sku: x.sku, qty: x.qty, bins: x.bins, counted: x.counted, places: x.places ?? {} });
      out.set(x.product_id, list);
    }
    return out;
  };

  if (mode === 'skus') {
    // page through sizes: skip the styles wholly before the page, then take styles until the page is full
    const start = f.all ? 0 : (page - 1) * per;
    let before = 0;
    const window: ProductFacts[] = [];
    for (const x of rows) {
      const n = counts.get(x.id)?.skus ?? 0;
      if (!window.length && before + n <= start) {
        before += n;
        continue;
      }
      window.push(x);
      if (!f.all && before + window.reduce((a, w) => a + (counts.get(w.id)?.skus ?? 0), 0) >= start + per) break;
    }
    const sizes = await sizesFor(window.map((x) => x.id));
    const flat: SkuLine[] = window.flatMap((x) => (sizes.get(x.id) ?? []).map((z) => ({ ...z, style: styleOf(x) })));
    const skus = f.all ? flat : flat.slice(start - before, start - before + per);
    return { mode, statusCounts, totals, locations, brands, categories, seasons, seesMoney: s.money, page, per, total: skuTotal, styles: [] as StyleRow[], sizes: new Map<string, SizeRow[]>(), skus, columns: [] as typeof locations };
  }

  const slice = f.all ? rows : rows.slice((page - 1) * per, page * per);
  const styles = slice.map(styleOf);
  const sizes = mode === 'styles' || f.all ? await sizesFor(slice.map((x) => x.id)) : new Map<string, SizeRow[]>();
  // the matrix's columns: the places that hold the most of what is on screen
  const columns = mode === 'matrix' ? locations.filter((l) => styles.some((x) => (x.byLocation[l.id] ?? 0) > 0)).slice(0, 12) : [];
  return { mode, statusCounts, totals, locations, brands, categories, seasons, seesMoney: s.money, page, per, total: rows.length, styles, sizes, skus: [] as SkuLine[], columns };
}

export type SizeRow = { id: string; size: string; barcode: string | null; sku: string; qty: number; bins: string | null; counted: string | null; places: Record<string, number> };
export type StyleRow = {
  id: string;
  title: string;
  brand: string;
  styleCode: string;
  image: string | null;
  market: string;
  season: string;
  category: string;
  currency: string;
  price: number | null;
  onHand: number;
  warehouse: number;
  shops: number;
  incoming: number;
  skus: number;
  skusIn: number;
  rate: number;
  cover: number;
  weeksSinceSale: number | null;
  velocity: Velocity;
  status: string;
  retail: number | null;
  next: string | null;
  byLocation: Record<string, number>;
};
export type SkuLine = SizeRow & { style: StyleRow };
export type Stockroom = Awaited<ReturnType<typeof stockroom>>;
