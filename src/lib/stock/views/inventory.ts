import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import type { Principal } from '../../domain/perms';
import { CATEGORY_LABEL, type Category } from '../../domain/stock/categories';
import type { Velocity } from '../../domain/stock/classify';
import { money } from '../../format';
import { factsFor, getFacts, type ProductFacts } from '../facts';
import { marketsFor, sees } from './common';

export type InvFilters = { q?: string; market?: string; company?: string; brand?: string; category?: string; velocity?: string; view?: string; location?: string; sort?: string; page?: number; /** every row, for an export */ all?: boolean };

export const INV_VIEWS: { key: string; label: string; hint: string }[] = [
  { key: 'all', label: 'Everything', hint: 'Every live style' },
  { key: 'risk', label: 'Running out', hint: 'Empty within six weeks at the forecast, or under three weeks of cover' },
  { key: 'clear', label: 'Too much stock', hint: 'Over half a year of cover, or not selling with pieces left' },
  { key: 'move', label: 'In the wrong place', hint: 'Sitting where it does not sell while somewhere else runs short' },
  { key: 'new', label: 'New in', hint: 'Live for under six weeks' },
];

const seasonClosed = (season: string) => {
  const m = new Date().getUTCMonth();
  if (season.startsWith('SS')) return m >= 8 || m <= 1;
  if (season.startsWith('AW')) return m >= 2 && m <= 6;
  return false;
};

const runsOut = (p: ProductFacts, week: string) => {
  if (!p.stockout) return p.cover < 3 && p.rate > 0.5;
  const weeks = (Date.parse(p.stockout) - Date.parse(week)) / (7 * 86_400_000);
  return weeks <= 6;
};

export async function inventoryList(p: Principal, f: InvFilters) {
  const db = await getDb();
  const facts = factsFor(await getFacts(), p);
  const s = sees(p);
  const markets = marketsFor(p);
  const moving = new Set(
    (
      await db.execute<{ product_id: string }>(sql`
        select distinct jsonb_array_elements(payload->'lines')->>'productId' as product_id from recommendations where status = 'open' and kind = 'transfer'`)
    ).rows.map((r) => r.product_id),
  );
  const recFor = new Map(
    (await db.execute<{ product_id: string; kind: string }>(sql`select product_id, kind from recommendations where status = 'open' and product_id is not null order by priority`)).rows.map((r) => [r.product_id, r.kind]),
  );

  const base = facts.products.filter((x) => markets.includes(x.market) && (!f.market || x.market === f.market) && (!f.company || x.company === f.company));
  const inView = (x: ProductFacts, view: string) => {
    if (view === 'risk') return runsOut(x, facts.week);
    if (view === 'clear') return x.onHand > 0 && (x.cover > 26 || x.velocity === 'dead');
    if (view === 'move') return moving.has(x.id);
    if (view === 'new') return x.velocity === 'new';
    return true;
  };
  const counts = Object.fromEntries(INV_VIEWS.map((v) => [v.key, base.filter((x) => inView(x, v.key)).length]));
  const q = f.q?.trim().toLowerCase();
  let rows = base.filter(
    (x) =>
      inView(x, f.view ?? 'all') &&
      (!f.brand || x.brand === f.brand) &&
      (!f.category || x.category === f.category) &&
      (!f.velocity || x.velocity === f.velocity || (f.velocity === 'slow' && x.velocity === 'dead')) &&
      (!f.location || (x.byLocation[f.location]?.onHand ?? 0) > 0) &&
      (!q || x.title.toLowerCase().includes(q) || x.styleCode.toLowerCase().includes(q) || x.brand.toLowerCase().includes(q)),
  );
  const sort = f.sort ?? (f.view === 'risk' ? 'cover' : 'value');
  const by: Record<string, (a: ProductFacts, b: ProductFacts) => number> = {
    value: (a, b) => b.valueRetailEgp - a.valueRetailEgp,
    rate: (a, b) => b.rate - a.rate,
    cover: (a, b) => (Number.isFinite(a.cover) ? a.cover : 1e9) - (Number.isFinite(b.cover) ? b.cover : 1e9),
    coverDesc: (a, b) => (Number.isFinite(b.cover) ? b.cover : 1e9) - (Number.isFinite(a.cover) ? a.cover : 1e9),
    sell: (a, b) => b.sellThrough8 - a.sellThrough8,
    units: (a, b) => b.onHand - a.onHand,
    name: (a, b) => a.title.localeCompare(b.title),
  };
  rows = rows.sort(by[sort] ?? by.value);
  const total = rows.length;
  const limit = 40;
  const page = Math.max(1, f.page ?? 1);
  const slice = f.all ? rows : rows.slice((page - 1) * limit, page * limit);

  const brands = [...new Set(base.map((x) => x.brand))].sort();
  const categories = [...new Set(base.map((x) => x.category))].sort().map((c) => ({ id: c, label: CATEGORY_LABEL[c as Category] }));

  return {
    view: f.view ?? 'all',
    counts,
    total,
    page,
    limit,
    brands,
    categories,
    seesMoney: s.money,
    totals: {
      styles: total,
      units: rows.reduce((a, x) => a + Math.max(0, f.location ? x.byLocation[f.location]?.onHand ?? 0 : x.onHand), 0),
      retail: s.money ? rows.reduce((a, x) => a + x.valueRetailEgp, 0) : null,
    },
    rows: slice.map((x) => ({
      id: x.id,
      title: x.title,
      brand: x.brand,
      image: x.image,
      styleCode: x.styleCode,
      market: x.market,
      company: x.company,
      season: x.season,
      category: CATEGORY_LABEL[x.category],
      price: s.money ? money(x.price, x.currency) : null,
      priceMinor: s.money ? x.price : null,
      currency: x.currency,
      onHand: f.location ? x.byLocation[f.location]?.onHand ?? 0 : x.onHand,
      warehouse: x.warehouseOnHand,
      shops: x.onHand - x.warehouseOnHand,
      places: Object.values(x.byLocation).filter((l) => l.onHand > 0).length,
      rate: x.rate,
      cover: x.cover,
      stockout: x.stockout,
      sellThrough: x.sellThrough8,
      abc: x.abc,
      xyz: x.xyz,
      velocity: x.velocity as Velocity,
      onOrder: x.onOrder,
      inDraft: x.inDraft,
      value: s.money ? x.valueRetailEgp : null,
      spark: x.weekly.slice(-12).map((o) => o.units),
      // a season's last pieces running out is the plan working, not a gap
      next: recFor.get(x.id) ?? (runsOut(x, facts.week) && seasonClosed(x.season) ? 'sellout' : null),
    })),
  };
}

export type InventoryList = Awaited<ReturnType<typeof inventoryList>>;
