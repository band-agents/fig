import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { seesBrand } from '../../domain/perms';
import { sameBrand } from '../../domain/branches';
import { factsFor, getFacts, type ProductFacts } from '../../stock/facts';
import { getTargets, monthKey, targetFor } from '../../targets';
import { egpMinor } from '../../stock/core';
import { catalogueReadAt } from '../../stock/live';
import { marketsFor } from '../../stock/views/common';
import type { Market } from '../../domain/stock/calendar';
import { bucketsOf, lineGross, lineNet, list, n, ratio, series, shareOf, SOLD, type Ctx, type Report, type Result, type Row } from '../engine';
import { breakdown, salesTotals } from './sales';

const brandHref = (b: string) => `/analytics/brand-scorecard?brand=${encodeURIComponent(b)}`;
const m = (c: Ctx, v: number) => (c.money ? v : null);

/** Catalogue styles in the person's markets and brands, narrowed by the brand and category filters. */
export async function stylesFor(c: Ctx): Promise<ProductFacts[]> {
  const markets = marketsFor(c.p) as Market[];
  return factsFor(await getFacts(), c.p).products.filter((x) => markets.includes(x.market) && (!c.q.brand || sameBrand(c.q.brand, x.brand)) && (!c.q.category || x.category === c.q.category));
}

/** Order lines joined to the catalogue style they belong to (by barcode, else SKU), for season and launch. */
const toStyle = sql`left join variants v on (v.barcode = oi.barcode and oi.barcode is not null) or (v.sku = oi.sku and oi.barcode is null)
  left join products pr on pr.id = v.product_id`;

const byBrand: Report = {
  id: 'sales-by-brand',
  group: 'brands',
  title: 'Sales by brand',
  blurb: "Each brand's net sales and pieces, its share, average price and discount, against the period before.",
  for: ['brand', 'finance', 'management'],
  filters: ['channel', 'category'],
  run: (c) => breakdown(c, { key: sql.raw(`coalesce(oi.brand, '—')`), label: 'Brand', name: (k) => k, href: brandHref }),
};

const byCategory: Report = {
  id: 'sales-by-category',
  group: 'brands',
  title: 'Sales by category',
  blurb: 'Bras, nightwear, tops, denim…: what each category sells, its share and its average price.',
  for: ['brand', 'management'],
  filters: ['channel', 'brand'],
  run: (c) => breakdown(c, { key: sql.raw(`coalesce(nullif(oi.category, ''), 'Uncategorised')`), label: 'Category', name: (k) => k, href: (k) => `/analytics/top-styles?category=${encodeURIComponent(k)}` }),
};

const topStyles: Report = {
  id: 'top-styles',
  group: 'brands',
  title: 'Best and worst selling styles',
  blurb: 'Every style sold in the period, best first: pieces, net sales, average price, sizes sold.',
  for: ['brand', 'management'],
  filters: ['channel', 'brand', 'category'],
  async run(c) {
    const db = await getDb();
    const r = await db.execute<{ title: string; brand: string; category: string; image: string | null; orders: number; units: number; gross: number; net: number; sizes: string }>(sql`
      select oi.title, coalesce(oi.brand, '—') as brand, coalesce(oi.category, '') as category, max(oi.image) as image, count(distinct o.id)::int as orders, sum(oi.quantity)::int as units,
        coalesce(sum(${lineGross(c)}), 0)::float8 as gross, coalesce(sum(${lineNet(c)}), 0)::float8 as net,
        string_agg(distinct nullif(oi.size, ''), ', ') as sizes
      from orders o join order_items oi on oi.order_id = o.id
      where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}
      group by 1, 2, 3`);
    const rows = r.rows
      .map<Row>((x) => ({ style: x.title, brand: x.brand, category: x.category, orders: n(x.orders), units: n(x.units), net: m(c, Math.round(n(x.net))), asp: c.money && n(x.units) ? Math.round(n(x.net) / n(x.units)) : null, discount: c.money ? ratio(n(x.gross) - n(x.net), n(x.gross)) : null, sizes: x.sizes ?? '' }))
      .sort((a, b) => (c.money ? n(b.net) - n(a.net) : n(b.units) - n(a.units)));
    const T = rows.reduce((a, x) => a + n(x.units), 0);
    const top10 = rows.slice(0, Math.max(1, Math.ceil(rows.length * 0.1))).reduce((a, x) => a + n(x.units), 0);
    return {
      figures: [
        { label: 'Styles sold', value: rows.length, fmt: 'int' },
        { label: 'Pieces', value: T, fmt: 'int' },
        { label: 'Top 10% of styles', value: shareOf(top10, T), fmt: 'pct', note: 'of pieces sold' },
        { label: 'Best seller', value: rows[0]?.style ?? '—', fmt: 'text', note: rows[0] ? `${rows[0].brand} · ${rows[0].units} pcs` : undefined },
      ],
      charts: [{ kind: 'bars', title: 'Top 15 styles', rows: rows.slice(0, 15).map((x) => ({ label: `${x.style}`, value: n(x.net), units: n(x.units), sub: String(x.brand) })), fmt: 'money', measured: true }],
      tables: [
        {
          title: 'Every style sold',
          sub: 'Best first. Styles that sold nothing are in Stock health and Fast and slow movers.',
          columns: [
            { key: 'style', label: 'Style', fmt: 'text', wide: true },
            { key: 'brand', label: 'Brand', fmt: 'text' },
            { key: 'category', label: 'Category', fmt: 'text' },
            { key: 'orders', label: 'Orders', fmt: 'int', total: true },
            { key: 'units', label: 'Pieces', fmt: 'int', total: true },
            ...(c.money ? [{ key: 'net', label: 'Net sales', fmt: 'money' as const, total: true }, { key: 'asp', label: 'Avg price', fmt: 'money' as const }, { key: 'discount', label: 'Discount', fmt: 'pct' as const }] : []),
            { key: 'sizes', label: 'Sizes sold', fmt: 'text' },
          ],
          rows,
        },
      ],
      empty: rows.length ? undefined : 'No sales in this period.',
    };
  },
};

/** Clothing and bra sizes in their natural order, the rest alphabetically after them. */
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL'];
const sizeRank = (s: string) => {
  const u = s.toUpperCase();
  const i = SIZE_ORDER.indexOf(u);
  if (i >= 0) return i;
  const num = parseFloat(u);
  if (Number.isFinite(num)) return 100 + num + (/[A-H]+$/.test(u) ? (u.match(/[A-H]+$/)![0].charCodeAt(0) - 64) / 100 : 0);
  return 10_000;
};

const bySize: Report = {
  id: 'sales-by-size',
  group: 'brands',
  title: 'Size curve',
  blurb: 'Which sizes sell, by category: the size mix to buy, and the sizes that run out first.',
  for: ['brand'],
  filters: ['channel', 'brand', 'category'],
  async run(c) {
    const db = await getDb();
    const r = await db.execute<{ category: string; size: string; units: number }>(sql`
      select coalesce(nullif(oi.category, ''), 'Uncategorised') as category, coalesce(nullif(oi.size, ''), 'One size') as size, sum(oi.quantity)::int as units
      from orders o join order_items oi on oi.order_id = o.id
      where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}
      group by 1, 2`);
    const bySize = new Map<string, number>();
    const catTotal = new Map<string, number>();
    for (const x of r.rows) {
      bySize.set(x.size, (bySize.get(x.size) ?? 0) + n(x.units));
      catTotal.set(x.category, (catTotal.get(x.category) ?? 0) + n(x.units));
    }
    const T = [...bySize.values()].reduce((a, v) => a + v, 0);
    const sizes = [...bySize.entries()].sort((a, b) => sizeRank(a[0]) - sizeRank(b[0]) || a[0].localeCompare(b[0]));
    const top = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      figures: [
        { label: 'Pieces', value: T, fmt: 'int' },
        { label: 'Sizes sold', value: bySize.size, fmt: 'int' },
        { label: 'Top size', value: top?.[0] ?? '—', fmt: 'text', note: top ? `${Math.round((top[1] / T) * 100)}% of pieces` : undefined },
      ],
      charts: [{ kind: 'bars', title: 'Pieces by size', rows: sizes.map(([s, u]) => ({ label: s, value: u, units: u, sub: `${Math.round((u / Math.max(1, T)) * 100)}%` })), fmt: 'int', ordered: true }],
      tables: [
        {
          title: 'By category and size',
          sub: 'Share is within the category, so each category adds up to 100%',
          columns: [
            { key: 'category', label: 'Category', fmt: 'text' },
            { key: 'size', label: 'Size', fmt: 'text' },
            { key: 'units', label: 'Pieces', fmt: 'int', total: true },
            { key: 'share', label: 'Share of category', fmt: 'pct' },
          ],
          rows: r.rows
            .sort((a, b) => a.category.localeCompare(b.category) || sizeRank(a.size) - sizeRank(b.size) || a.size.localeCompare(b.size))
            .map((x) => ({ category: x.category, size: x.size, units: n(x.units), share: shareOf(n(x.units), catTotal.get(x.category) ?? 0) })),
        },
      ],
      empty: T ? undefined : 'No sales in this period.',
    };
  },
};

const scorecard: Report = {
  id: 'brand-scorecard',
  group: 'brands',
  title: 'Brand scorecard',
  blurb: "One brand on one page: sales, price, discount, returns, stock, cover and sell-through, its best styles, categories and sizes.",
  for: ['brand', 'management'],
  filters: ['brand', 'channel'],
  async run(c) {
    const db = await getDb();
    if (!c.q.brand) {
      // no brand chosen: the brands to pick from, best first
      const r = await breakdown(c, { key: sql.raw(`coalesce(oi.brand, '—')`), label: 'Brand', name: (k) => k, href: brandHref });
      return { ...r, notes: ['Pick a brand (filter above, or a name below) for its scorecard.'] };
    }
    const keys = bucketsOf(c.range);
    const [now, prev, trend, cats, sizes, styles, rets, all] = await Promise.all([
      salesTotals(c),
      salesTotals(c, 'prev'),
      db.execute<{ k: string; units: number; net: number }>(sql`
        select ${c.day(sql`o.placed_at`, c.range.grain)}::text as k, sum(oi.quantity)::int as units, coalesce(sum(${lineNet(c)}), 0)::float8 as net
        from orders o join order_items oi on oi.order_id = o.id where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)} group by 1`),
      db.execute<{ k: string; units: number; net: number }>(sql`
        select coalesce(nullif(oi.category, ''), 'Uncategorised') as k, sum(oi.quantity)::int as units, coalesce(sum(${lineNet(c)}), 0)::float8 as net
        from orders o join order_items oi on oi.order_id = o.id where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)} group by 1 order by 3 desc`),
      db.execute<{ k: string; units: number }>(sql`
        select coalesce(nullif(oi.size, ''), 'One size') as k, sum(oi.quantity)::int as units
        from orders o join order_items oi on oi.order_id = o.id where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)} group by 1`),
      db.execute<{ k: string; units: number; net: number }>(sql`
        select oi.title as k, sum(oi.quantity)::int as units, coalesce(sum(${lineNet(c)}), 0)::float8 as net
        from orders o join order_items oi on oi.order_id = o.id where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)} group by 1 order by 3 desc limit 20`),
      db.execute<{ sold: number; returned: number }>(sql`
        select coalesce(sum(oi.quantity), 0)::int as sold, coalesce(sum(ri.q), 0)::int as returned
        from orders o join order_items oi on oi.order_id = o.id
        left join (select order_item_id, sum(quantity) as q from return_items group by 1) ri on ri.order_item_id = oi.id
        where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}`),
      // the brand's share of everything sold in the same stores
      db.execute<{ net: number; units: number }>(sql`
        select coalesce(sum(${lineNet(c)}), 0)::float8 as net, coalesce(sum(oi.quantity), 0)::int as units
        from orders o join order_items oi on oi.order_id = o.id
        where o.channel_id in (${list(c.channels)}) and ${SOLD()} and ${c.between(sql`o.placed_at`)}`),
    ]);
    const styles13 = await stylesFor(c);
    const onHand = styles13.reduce((a, x) => a + x.onHand, 0);
    const sold13 = styles13.reduce((a, x) => a + x.sold13, 0);
    const stockValue = styles13.reduce((a, x) => a + x.valueRetailEgp, 0);
    const rate = sold13 / 13;
    const ret = rets.rows[0];
    const share = c.money ? shareOf(now.net, n(all.rows[0]?.net)) : shareOf(now.units, n(all.rows[0]?.units));
    const sizeRows = sizes.rows.sort((a, b) => sizeRank(a.k) - sizeRank(b.k) || a.k.localeCompare(b.k));
    const sizeTotal = sizeRows.reduce((a, x) => a + n(x.units), 0);
    return {
      figures: [
        ...(c.money ? [{ label: 'Net sales', value: now.net, fmt: 'money' as const, prev: prev.net, better: 'up' as const }] : []),
        { label: 'Pieces', value: now.units, fmt: 'int', prev: prev.units, better: 'up' },
        { label: 'Share of all sales', value: share, fmt: 'pct' },
        ...(c.money ? [{ label: 'Average piece price', value: now.units ? Math.round(now.net / now.units) : null, fmt: 'money' as const }, { label: 'Discount depth', value: ratio(now.gross - now.net, now.gross), fmt: 'pct' as const, better: 'down' as const }] : []),
        { label: 'Return rate', value: ratio(n(ret?.returned), n(ret?.sold)), fmt: 'pct', better: 'down', note: 'pieces returned of pieces sold' },
        { label: 'Stock on hand', value: onHand, fmt: 'int', note: c.money ? undefined : 'pieces' },
        ...(c.money ? [{ label: 'Stock at retail', value: stockValue, fmt: 'money' as const }] : []),
        { label: 'Cover', value: rate ? onHand / rate : null, fmt: 'weeks', note: 'at the last 13 weeks’ pace' },
        { label: 'Sell-through, 13 weeks', value: ratio(sold13, sold13 + onHand), fmt: 'pct', better: 'up' },
      ],
      charts: [
        {
          kind: 'trend',
          title: `${c.q.brand} by ${c.range.grain}`,
          labels: keys,
          series: [
            ...(c.money ? [{ name: 'Net sales', values: series(keys, trend.rows.map((r) => ({ k: r.k, v: Math.round(n(r.net)) }))), measure: 'value' as const }] : []),
            { name: 'Pieces', values: series(keys, trend.rows.map((r) => ({ k: r.k, v: n(r.units) }))), measure: 'units' },
          ],
        },
        { kind: 'bars', title: 'By category', rows: cats.rows.map((r) => ({ label: r.k, value: Math.round(n(r.net)), units: n(r.units) })), fmt: 'money', measured: true },
        { kind: 'bars', title: 'Size curve', rows: sizeRows.map((r) => ({ label: r.k, value: n(r.units), units: n(r.units), sub: `${Math.round((n(r.units) / Math.max(1, sizeTotal)) * 100)}%` })), fmt: 'int', ordered: true },
      ],
      tables: [
        {
          title: 'Best styles',
          columns: [{ key: 'style', label: 'Style', fmt: 'text', wide: true }, { key: 'units', label: 'Pieces', fmt: 'int', total: true }, ...(c.money ? [{ key: 'net', label: 'Net sales', fmt: 'money' as const, total: true }] : [])],
          rows: styles.rows.map((r) => ({ style: r.k, units: n(r.units), net: m(c, Math.round(n(r.net))) })),
        },
        {
          title: 'Stock by style',
          sub: 'Most on hand first',
          columns: [
            { key: 'style', label: 'Style', fmt: 'text', wide: true },
            { key: 'season', label: 'Season', fmt: 'text' },
            { key: 'onHand', label: 'On hand', fmt: 'int', total: true },
            { key: 'sold13', label: 'Sold, 13 wk', fmt: 'int', total: true },
            { key: 'cover', label: 'Cover', fmt: 'weeks' },
            { key: 'st', label: 'Sell-through', fmt: 'pct' },
          ],
          rows: styles13
            .filter((x) => x.onHand > 0 || x.sold13 > 0)
            .sort((a, b) => b.onHand - a.onHand)
            .slice(0, 300)
            .map((x) => ({ style: x.title, season: x.season, onHand: x.onHand, sold13: x.sold13, cover: x.sold13 ? x.onHand / (x.sold13 / 13) : null, st: ratio(x.sold13, x.sold13 + x.onHand), _href: `/stock/inventory/${x.id}` })),
        },
      ],
      empty: now.units || onHand ? undefined : `Nothing sold or in stock for ${c.q.brand} in this period.`,
    };
  },
};

const targets: Report = {
  id: 'sales-vs-target',
  group: 'brands',
  title: 'Sales against target',
  blurb: "Each brand's sales against its monthly target (Brands → Import targets), month by month in the period.",
  for: ['brand', 'finance', 'management'],
  filters: ['channel', 'brand'],
  needs: ['money'],
  async run(c) {
    const db = await getDb();
    const markets = marketsFor(c.p) as Market[];
    const all = await Promise.all(markets.map((mk) => getTargets(mk)));
    const r = await db.execute<{ month: string; brand: string; units: number; net: number }>(sql`
      select to_char(o.placed_at at time zone ${c.tz}, 'YYYY-MM') as month, coalesce(oi.brand, '—') as brand, sum(oi.quantity)::int as units, coalesce(sum(${lineNet(c)}), 0)::float8 as net
      from orders o join order_items oi on oi.order_id = o.id
      where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)} group by 1, 2`);
    const sold = new Map(r.rows.map((x) => [`${x.month}|${x.brand.toLowerCase()}`, x]));
    const months: string[] = [];
    for (let d = new Date(c.range.from); d < c.range.to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(monthKey(d));
    const rows: Row[] = [];
    // every brand with a target in these months, and every brand that sold without one
    const brands = new Set<string>(r.rows.map((x) => x.brand));
    for (const t of all) for (const b of Object.keys(t)) if (seesBrand(c.p, b) && (!c.q.brand || sameBrand(c.q.brand, b))) brands.add(b);
    for (const month of months)
      for (const b of [...brands].sort()) {
        const mk = markets.find((x, i) => targetFor(all[i], b, month));
        const t = mk ? targetFor(all[markets.indexOf(mk)], b, month) : null;
        const s = [...sold.entries()].find(([k]) => k.startsWith(`${month}|`) && sameBrand(k.slice(8), b))?.[1];
        if (!t && !s) continue;
        const cur = mk === 'KW' ? 'KWD' : 'EGP';
        const tv = t?.value != null ? egpMinor(t.value, cur) : null;
        rows.push({ month, brand: b, net: Math.round(n(s?.net)), target: tv, hit: tv ? n(s?.net) / tv : null, units: n(s?.units), targetUnits: t?.units ?? null, hitUnits: t?.units ? n(s?.units) / t.units : null });
      }
    const withT = rows.filter((x) => x.target != null);
    const tSum = withT.reduce((a, x) => a + n(x.target), 0);
    const aSum = withT.reduce((a, x) => a + n(x.net), 0);
    return {
      figures: [
        { label: 'Achieved', value: tSum ? aSum / tSum : null, fmt: 'pct', note: 'of target, brands with a target' },
        { label: 'Sales', value: aSum, fmt: 'money' },
        { label: 'Target', value: tSum, fmt: 'money' },
        { label: 'Brands on or above target', value: withT.filter((x) => n(x.hit) >= 1).length, fmt: 'int', note: `of ${withT.length}` },
      ],
      charts: [{ kind: 'bars', title: 'Achieved against target', rows: withT.sort((a, b) => n(b.hit) - n(a.hit)).slice(0, 15).map((x) => ({ label: `${x.brand} · ${x.month}`, value: n(x.hit) })), fmt: 'pct' }],
      tables: [
        {
          title: 'By brand and month',
          columns: [
            { key: 'month', label: 'Month', fmt: 'text' },
            { key: 'brand', label: 'Brand', fmt: 'text', wide: true },
            { key: 'net', label: 'Net sales', fmt: 'money', total: true },
            { key: 'target', label: 'Target', fmt: 'money', total: true },
            { key: 'hit', label: 'Achieved', fmt: 'pct' },
            { key: 'units', label: 'Pieces', fmt: 'int', total: true },
            { key: 'targetUnits', label: 'Target pieces', fmt: 'int', total: true },
            { key: 'hitUnits', label: 'Achieved', fmt: 'pct' },
          ],
          rows,
        },
      ],
      notes: withT.length ? undefined : ['No targets for these months yet: Brands → Import targets takes a sheet of brand, month and target.'],
      empty: rows.length ? undefined : 'No sales and no targets in this period.',
    };
  },
};

/** Sales joined to the catalogue: season, launch date. Lines whose barcode is not in the catalogue fall under "Not in catalogue". */
async function salesByStyle(c: Ctx) {
  const db = await getDb();
  const r = await db.execute<{ pid: string | null; season: string | null; units: number; net: number }>(sql`
    select pr.id as pid, pr.season, sum(oi.quantity)::int as units, coalesce(sum(${lineNet(c)}), 0)::float8 as net
    from orders o join order_items oi on oi.order_id = o.id ${toStyle}
    where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}
    group by 1, 2`);
  return r.rows.map((x) => ({ pid: x.pid, season: x.season, units: n(x.units), net: Math.round(n(x.net)) }));
}

const seasons: Report = {
  id: 'season-performance',
  group: 'brands',
  title: 'Season performance',
  blurb: 'AW26 against SS26 and older seasons: styles, pieces sold, net sales, stock left and sell-through.',
  for: ['brand', 'management'],
  filters: ['channel', 'brand', 'category'],
  async run(c) {
    const [sales, styles, readAt] = await Promise.all([salesByStyle(c), stylesFor(c), catalogueReadAt(c.channels)]);
    const agg = new Map<string, { styles: number; live: number; units: number; net: number; onHand: number; stock: number }>();
    const get = (k: string) => agg.get(k) ?? (agg.set(k, { styles: 0, live: 0, units: 0, net: 0, onHand: 0, stock: 0 }), agg.get(k)!);
    for (const x of styles) {
      const a = get(x.season || 'No season');
      a.styles += 1;
      if (x.status === 'active') a.live += 1;
      a.onHand += x.onHand;
      a.stock += x.valueRetailEgp;
    }
    for (const s of sales) {
      const a = get(s.pid ? s.season || 'No season' : 'Not in catalogue');
      a.units += s.units;
      a.net += s.net;
    }
    const rows = [...agg.entries()]
      .map<Row>(([k, a]) => ({ season: k, styles: a.styles, live: a.live, units: a.units, net: m(c, a.net), onHand: a.onHand, stock: m(c, a.stock), st: ratio(a.units, a.units + a.onHand) }))
      .sort((a, b) => String(b.season).localeCompare(String(a.season)));
    return {
      figures: [
        { label: 'Seasons', value: rows.filter((r) => r.season !== 'Not in catalogue').length, fmt: 'int' },
        { label: 'Pieces sold', value: sales.reduce((a, s) => a + s.units, 0), fmt: 'int' },
        { label: 'Not matched to a season', value: shareOf(sales.filter((s) => !s.pid).reduce((a, s) => a + s.units, 0), sales.reduce((a, s) => a + s.units, 0)), fmt: 'pct', note: 'pieces whose barcode is not in the catalogue' },
      ],
      charts: [{ kind: 'bars', title: 'Sales by season', rows: rows.map((r) => ({ label: String(r.season), value: n(r.net), units: n(r.units), sub: r.st != null ? `${Math.round(n(r.st) * 100)}% sold through` : undefined })), fmt: 'money', measured: true }],
      tables: [
        {
          title: 'By season',
          sub: 'Sell-through = pieces sold in the period of pieces sold + on hand',
          columns: [
            { key: 'season', label: 'Season', fmt: 'text', wide: true },
            { key: 'styles', label: 'Styles', fmt: 'int', total: true },
            { key: 'live', label: 'Live', fmt: 'int', total: true },
            { key: 'units', label: 'Pieces sold', fmt: 'int', total: true },
            ...(c.money ? [{ key: 'net', label: 'Net sales', fmt: 'money' as const, total: true }] : []),
            { key: 'onHand', label: 'On hand', fmt: 'int', total: true },
            ...(c.money ? [{ key: 'stock', label: 'Stock at retail', fmt: 'money' as const, total: true }] : []),
            { key: 'st', label: 'Sell-through', fmt: 'pct' },
          ],
          rows,
        },
      ],
      notes: styles.every((x) => !x.season || x.season === 'core')
        ? [`Seasons come from the AW26, SS26… tags on the store's products. The catalogue was last read from Shopify ${readAt ? `on ${readAt.toISOString().slice(0, 10)}` : 'once'}, before those tags were added; it is read again every night, and the seasons show after the next reading.`]
        : undefined,
      empty: rows.length ? undefined : 'No styles or sales for these filters.',
    };
  },
};

const newIn: Report = {
  id: 'new-arrivals',
  group: 'brands',
  title: 'New arrivals',
  blurb: 'Styles launched in the period: how fast they started, what is left, and which need a push.',
  for: ['brand', 'management'],
  filters: ['channel', 'brand', 'category'],
  async run(c) {
    const [sales, styles] = await Promise.all([salesByStyle(c), stylesFor(c)]);
    const sold = new Map<string, { units: number; net: number }>();
    for (const s of sales) if (s.pid) sold.set(s.pid, { units: s.units, net: s.net });
    const fresh = styles.filter((x) => x.launchedAt >= c.range.from && x.launchedAt < c.range.to);
    const day = 86_400_000;
    const rows = fresh
      .map<Row>((x) => {
        const s = sold.get(x.id);
        const days = Math.max(1, Math.round((Date.now() - x.launchedAt.getTime()) / day));
        return { style: x.title, brand: x.brand, season: x.season, launched: x.launchedAt.toISOString().slice(0, 10), days, units: s?.units ?? 0, net: m(c, s?.net ?? 0), perWeek: ((s?.units ?? 0) / days) * 7, onHand: x.onHand, st: ratio(s?.units ?? 0, (s?.units ?? 0) + x.onHand), _href: `/stock/inventory/${x.id}` };
      })
      .sort((a, b) => n(b.units) - n(a.units));
    const unsold = rows.filter((r) => !n(r.units) && n(r.onHand) > 0).length;
    return {
      figures: [
        { label: 'Styles launched', value: rows.length, fmt: 'int' },
        { label: 'Pieces sold', value: rows.reduce((a, r) => a + n(r.units), 0), fmt: 'int' },
        { label: 'Not sold yet', value: unsold, fmt: 'int', better: 'down', note: 'launched, in stock, no sale' },
        { label: 'Sell-through', value: ratio(rows.reduce((a, r) => a + n(r.units), 0), rows.reduce((a, r) => a + n(r.units) + n(r.onHand), 0)), fmt: 'pct' },
      ],
      charts: [],
      tables: [
        {
          title: 'Styles launched in the period',
          columns: [
            { key: 'style', label: 'Style', fmt: 'text', wide: true },
            { key: 'brand', label: 'Brand', fmt: 'text' },
            { key: 'season', label: 'Season', fmt: 'text' },
            { key: 'launched', label: 'Launched', fmt: 'date' },
            { key: 'units', label: 'Pieces sold', fmt: 'int', total: true },
            { key: 'perWeek', label: 'A week', fmt: 'num' },
            ...(c.money ? [{ key: 'net', label: 'Net sales', fmt: 'money' as const, total: true }] : []),
            { key: 'onHand', label: 'On hand', fmt: 'int', total: true },
            { key: 'st', label: 'Sell-through', fmt: 'pct' },
          ],
          rows,
        },
      ],
      empty: rows.length ? undefined : 'No styles launched in this period.',
    };
  },
};

const markdown: Report = {
  id: 'full-price-vs-markdown',
  group: 'brands',
  title: 'Full price vs sale',
  blurb: "How much of each brand sells at full price and how much on sale (a compare-at price above the selling price).",
  for: ['brand', 'finance', 'management'],
  filters: ['channel', 'brand', 'category'],
  async run(c): Promise<Result> {
    const db = await getDb();
    const r = await db.execute<{ brand: string; full_u: number; sale_u: number; full_v: number; sale_v: number }>(sql`
      select coalesce(oi.brand, '—') as brand,
        coalesce(sum(oi.quantity) filter (where coalesce(pr.compare_at, 0) <= oi.unit_price), 0)::int as full_u,
        coalesce(sum(oi.quantity) filter (where pr.compare_at > oi.unit_price), 0)::int as sale_u,
        coalesce(sum(${lineNet(c)}) filter (where coalesce(pr.compare_at, 0) <= oi.unit_price), 0)::float8 as full_v,
        coalesce(sum(${lineNet(c)}) filter (where pr.compare_at > oi.unit_price), 0)::float8 as sale_v
      from orders o join order_items oi on oi.order_id = o.id ${toStyle}
      where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}
      group by 1`);
    const rows = r.rows
      .map<Row>((x) => ({ brand: x.brand, fullU: n(x.full_u), saleU: n(x.sale_u), saleShare: shareOf(n(x.sale_u), n(x.full_u) + n(x.sale_u)), fullV: m(c, Math.round(n(x.full_v))), saleV: m(c, Math.round(n(x.sale_v))), _href: brandHref(x.brand) }))
      .sort((a, b) => n(b.fullU) + n(b.saleU) - (n(a.fullU) + n(a.saleU)));
    const F = rows.reduce((a, x) => a + n(x.fullU), 0);
    const S = rows.reduce((a, x) => a + n(x.saleU), 0);
    return {
      figures: [
        { label: 'Sold at full price', value: shareOf(F, F + S), fmt: 'pct', better: 'up', note: `${F} pieces` },
        { label: 'Sold on sale', value: shareOf(S, F + S), fmt: 'pct', better: 'down', note: `${S} pieces` },
      ],
      charts: [{ kind: 'bars', title: 'Share sold on sale, by brand', rows: rows.filter((x) => n(x.fullU) + n(x.saleU) > 0).map((x) => ({ label: String(x.brand), value: n(x.saleShare), sub: `${x.saleU} of ${n(x.fullU) + n(x.saleU)} pcs`, href: x._href })), fmt: 'pct' }],
      tables: [
        {
          title: 'By brand',
          columns: [
            { key: 'brand', label: 'Brand', fmt: 'text', wide: true },
            { key: 'fullU', label: 'Full price pcs', fmt: 'int', total: true },
            { key: 'saleU', label: 'Sale pcs', fmt: 'int', total: true },
            { key: 'saleShare', label: 'On sale', fmt: 'pct' },
            ...(c.money ? [{ key: 'fullV', label: 'Full price sales', fmt: 'money' as const, total: true }, { key: 'saleV', label: 'Sale sales', fmt: 'money' as const, total: true }] : []),
          ],
          rows,
        },
      ],
      notes: ['On sale means the style has a compare-at price above what the customer paid, read from today’s catalogue.'],
      empty: rows.length ? undefined : 'No sales in this period.',
    };
  },
};

export const BRAND_REPORTS: Report[] = [byBrand, byCategory, topStyles, bySize, scorecard, targets, seasons, newIn, markdown];
